/* ===== AI 对话：点击吉祥物本体 → 下方浮出胶囊输入框 → Enter 提交 =====
   自成一份，只通过 initAiChat(api) 与 index.html 耦合。api 契约见 index.html 调用处。

   ⚠ **API Key 一律不写在这里**。默认走 Cloudflare Worker 代理（worker/ 目录，见该目录 README），
     由它拿着密钥转发给智谱 —— 前端零密钥，所以这个站可以公开发布。
     想在本地临时直连（key 会进前端，只适合自己看）：把 endpoint 换成智谱完整地址 + 传 apiKey。

   免费模型选型（2026-09 现状，改 provider 时对照）：
     · 智谱 GLM-4-Flash —— 永久免费、无 Token 上限、国内直连、支持 function calling  ← 默认
     · 硅基流动 —— 一个 key 调 100+ 模型，含免费档
     · OpenRouter —— 30+ 免费模型一个 key，但**不发 CORS 头**，必须过代理才能从浏览器调
   请求体用 **OpenAI 兼容格式**（`/chat/completions`），三家都认，换后端只改 endpoint + model。 */

const DEFAULTS = {
  endpoint: '',      // 必填：index.html 里传代理地址（worker 部署后打印的那个）
  apiKey: '',        // 可选：只有本地直连才用得上；经代理时留空，密钥在服务端
  model: 'glm-4-flash',
  system: [
    '你是 STRCAT 的吉祥物，一颗会点头的玻璃球。说话简短、口语化，中文回答，一次不超过 40 字。',
    '你可以查天气和当前时间。需要这两类实时信息时调用工具，不要凭记忆编造。',
    '用户没指定城市时，先问一句而不是乱猜。',
  ].join(''),
  timeout: 20000,
};

/* ---------- 工具：天气 / 时间 ----------
   两个都是「前端直接查、不问模型」的实时数据 —— 模型只负责决定「该不该查、查哪儿」，
   数值一律由 API 给出，避免它编天气、算错时间。 */

/* Open-Meteo：免费、无需 key、CORS 全开。先地名搜索拿经纬度，再取当前天气。 */
const GEO_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const WX_URL  = 'https://api.open-meteo.com/v1/forecast';

/* WMO 天气代码 → 中文（Open-Meteo 用的就是这套） */
const WMO = {
  0: '晴', 1: '大致晴朗', 2: '局部多云', 3: '阴',
  45: '雾', 48: '雾凇',
  51: '小毛毛雨', 53: '毛毛雨', 55: '大毛毛雨',
  56: '冻毛毛雨', 57: '强冻毛毛雨',
  61: '小雨', 63: '中雨', 65: '大雨',
  66: '冻雨', 67: '强冻雨',
  71: '小雪', 73: '中雪', 75: '大雪', 77: '雪粒',
  80: '阵雨', 81: '强阵雨', 82: '暴雨',
  85: '小阵雪', 86: '大阵雪',
  95: '雷阵雨', 96: '雷阵雨伴冰雹', 99: '强雷阵雨伴冰雹',
};

async function getWeather(city, signal) {
  if (!city) return { error: '没给城市名' };
  const g = await fetch(`${GEO_URL}?name=${encodeURIComponent(city)}&count=1&language=zh&format=json`, { signal })
    .then((r) => r.json());
  const hit = g && g.results && g.results[0];
  if (!hit) return { error: `没找到「${city}」这个地方` };
  const w = await fetch(
    `${WX_URL}?latitude=${hit.latitude}&longitude=${hit.longitude}` +
    '&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m' +
    '&daily=temperature_2m_max,temperature_2m_min,weather_code&forecast_days=1&timezone=auto',
    { signal }
  ).then((r) => r.json());
  const c = w.current || {};
  const d = (w.daily || {});
  return {
    city: hit.name + (hit.admin1 && hit.admin1 !== hit.name ? `（${hit.admin1}）` : ''),
    desc: WMO[c.weather_code] || `代码 ${c.weather_code}`,
    温度: `${Math.round(c.temperature_2m)}°C`,
    今日: `${Math.round(d.temperature_2m_min?.[0])}° ~ ${Math.round(d.temperature_2m_max?.[0])}°`,
    湿度: `${c.relative_humidity_2m}%`,
    风速: `${c.wind_speed_10m} km/h`,
  };
}

function getTime() {
  const n = new Date();
  return {
    本地时间: n.toLocaleString('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', weekday: 'long',
    }),
    时区: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

/* 给模型看的工具声明（OpenAI 兼容 tools 格式） */
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_weather',
      description: '查某个城市的当前天气与今日气温区间。用户问天气时必须调用，不要凭记忆回答。',
      parameters: {
        type: 'object',
        properties: { city: { type: 'string', description: '城市名，如「广州」「北京」' } },
        required: ['city'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_time',
      description: '取用户设备上的当前日期与时间。用户问时间/日期/星期几时调用，不要自己推算。',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
];

const TOOL_IMPL = {
  get_weather: (a, signal) => getWeather(a && a.city, signal),
  get_time: () => getTime(),
};

/* ============================ 主模块 ============================ */

export function initAiChat(userApi = {}) {
  const API = { ...DEFAULTS, ...userApi };
  const {
    onBusy,          // (busy:boolean) => void  处理中：吉祥物回正停转、环停转
    setRingText,     // (text:string) => void   把结果写进外围字符环（宿主注入时允许分段：环停转归位后静止展示）
    isBlocked,       // () => boolean           面板展开/定制态等 → 不响应点击
    onToggle,        // (open:boolean) => void  输入框浮出/收起（宿主据此停掉本体的 hover 弹跳）
    rendererCanvas,  // HTMLCanvasElement       3D 画布
    hitMascot,       // (e:PointerEvent) => bool 该点是否砸在吉祥物本体/耳朵上（宿主提供，用它的射线）
  } = API;

  /* ---------- 1 · 输入框（挂 document.body，不落进 #app 的 3D 层） ---------- */
  const bar = document.createElement('form');
  bar.className = 'ai-chat';
  bar.setAttribute('role', 'search');
  bar.innerHTML =
    '<span class="ai-chat__hint" aria-hidden="true">ASK</span>' +
    '<input class="ai-chat__input" type="text" maxlength="120" autocomplete="off" ' +
    'spellcheck="false" aria-label="问吉祥物" placeholder="问我天气、时间，或随便聊聊">' +
    '<span class="ai-chat__state" aria-live="polite"></span>';
  document.body.appendChild(bar);

  const input = bar.querySelector('.ai-chat__input');
  const state = bar.querySelector('.ai-chat__state');

  /* 没填 key 就在控制台提醒一句 —— 免得「点本体没反应 / 按 Enter 报错」时一头雾水 */
  if (!API.endpoint || !API.apiKey) {
    console.warn(
      '[ai-chat] 还没配好接口：' + (!API.endpoint ? '缺少 endpoint；' : '') +
      (!API.apiKey ? '缺少 apiKey（本地自用需在 index.html 的 AI_API_KEY 填智谱 sk- 密钥；' +
                     '若走 worker 代理则密钥在服务端，无需此项）' : '')
    );
  }

  let open = false;      // 输入框是否浮出
  let busy = false;      // 是否正在处理
  let abort = null;      // 当前请求的 AbortController
  let timedOut = false;  // 本次请求是否是自己掐的超时（用来区分「超时」与「用户按 Esc」）

  /* 浮出/收起：位移走独立的 translate 属性，与 GSAP 的 transform 互不覆盖 */
  function show() {
    if (open) return;
    open = true;
    bar.classList.add('is-open');
    if (onToggle) onToggle(true);   // 宿主据此停掉本体 hover 弹跳
    /* 等过渡起手后再聚焦，免得 iOS 上键盘弹起与动画打架 */
    requestAnimationFrame(() => input.focus({ preventScroll: true }));
  }
  function hide() {
    if (!open) return;
    open = false;
    bar.classList.remove('is-open');
    if (onToggle) onToggle(false);
    input.blur();
  }

  function setState(text, cls) {
    state.textContent = text || '';
    bar.classList.toggle('is-busy', cls === 'busy');
    bar.classList.toggle('is-error', cls === 'error');
  }

  /* ---------- 2 · 点击吉祥物本体 → 浮出 ----------
     监听挂 document：吉祥物是 WebGL 里的对象，拿不到 DOM 事件，
     由 index.html 的拾取回调告诉我「点中了本体」。
     ⚠ 已呼出时**直接返回**：不重放浮出动画，也不做任何反应 —— 用户此刻是在看结果。 */
  window.addEventListener('mascot:click', () => {
    if (open) return;
    if (isBlocked && isBlocked()) return;
    show();
  });

  /* 点空白处收起（但别把输入框自己的点击算进去）
     ⚠ 挂在捕获阶段，早于 3D 画布的 pointerup 拾取触发。若点在吉祥物本体上，
       必须**放过**这一下：否则会「先 hide（摘掉 is-open）→ 再被 mascot:click 重新 show」，
       class 一摘一挂 = 浮出动画整个重放一遍 —— 这正是「呼出后点击又弹一次」的成因。

     ⚠ 但**不能简单放过整块画布**（画布铺满视口，那么写等于「点哪儿都不收起」）。
       画布上的点要问宿主「这是不是砸在本体上」：
         · 命中本体/耳朵 → 放过（交给 mascot:click 那条路）
         · 没命中        → 就是点了背景，照常收起
       判定交给宿主（它已有现成的拾取函数与射线缓存）；宿主没提供就退回「一律当空白」。 */
  document.addEventListener('pointerdown', (e) => {
    if (!open || bar.contains(e.target)) return;
    if (e.target === rendererCanvas && hitMascot && hitMascot(e)) return;
    hide();
  }, true);

  /* Esc 收起 + 打断在跑的请求 */
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !open) return;
    if (abort) abort.abort();
    hide();
  });

  /* ---------- 3 · 提交 ---------- */
  bar.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q || busy) return;
    input.value = '';
    ask(q);
  });

  /* ---------- 4 · 一次问答 ----------
     两轮：① 把问题+工具丢给模型，它可能要求调工具；② 把工具结果回灌，拿最终答复。
     最多两轮 —— 我们这个场景只有两个工具，不需要多步推理。 */
  async function ask(question) {
    if (busy) return;
    busy = true;
    setState('· · ·', 'busy');
    if (onBusy) onBusy(true);           // ← 吉祥物回正停转、环停转在这里发生
    abort = new AbortController();
    timedOut = false;
    const timer = setTimeout(() => { timedOut = true; abort.abort(); }, API.timeout);

    try {
      let msgs = [
        { role: 'system', content: API.system },
        { role: 'user', content: question },
      ];
      let answer = '';

      /* 真实后端第一轮通常只回 tool_calls（content 为 null），要回灌结果再来一轮；
         但部分模型会「边调工具边给话」，那种情况直接用它的 content，省一次往返。 */
      for (let round = 0; round < 2; round++) {
        const res = await post(msgs, abort.signal);
        const choice = res.choices && res.choices[0];
        const m = choice && choice.message;
        if (!m) throw new Error(msgOf(choice) || '模型没有返回内容');

        const calls = m.tool_calls;
        if (!calls || !calls.length) { answer = m.content || ''; break; }

        if (m.content) answer = m.content;   // 有话说就留着，第二轮没更好答案时兜底

        /* 有工具调用：先执行，再把结果作为 tool 消息回灌 */
        msgs.push(m);
        for (const c of calls) {
          const impl = TOOL_IMPL[c.function.name];
          let out;
          try {
            out = impl
              ? await impl(safeJson(c.function.arguments), abort.signal)
              : { error: `没有这个工具：${c.function.name}` };
          } catch (err) {
            if (err && err.name === 'AbortError') throw err;   // 超时别吞成「工具出错」
            out = { error: String(err && err.message || err) };
          }
          msgs.push({ role: 'tool', tool_call_id: c.id || `call_${round}`, content: JSON.stringify(out) });
        }
      }

      if (!answer) throw new Error('EMPTY_REPLY');
      setState('');
      if (setRingText) setRingText(answer);        // ← 结果写进外围字符环
      bar.classList.add('is-done');
      setTimeout(() => bar.classList.remove('is-done'), 900);
    } catch (err) {
      const e = err || {};
      if (e.name === 'AbortError') setState(isTimeout() ? '超时了' : '已取消', 'error');
      else if (e.message === 'EMPTY_REPLY') setState('没答上来', 'error');
      else setState(niceError(e), 'error');
    } finally {
      clearTimeout(timer);
      abort = null;
      busy = false;
      /* 出错了就保留红字，别被下面这行擦掉；正常结束则清空状态槽 */
      const failed = bar.classList.contains('is-error');
      bar.classList.remove('is-busy');
      if (!failed) setState('');
      if (onBusy) { /* 处理结束：不回正，保持静止等用户下一个问题 */ }
    }
  }

  async function post(messages, signal) {
    if (!API.endpoint) throw new Error('NO_ENDPOINT');
    const headers = { 'Content-Type': 'application/json' };
    if (API.apiKey) headers.Authorization = `Bearer ${API.apiKey}`;   // 仅本地直连用
    let r;
    try {
      r = await fetch(API.endpoint, {
        method: 'POST',
        signal,
        headers,
        body: JSON.stringify({
          model: API.model,
          messages,
          tools: TOOLS,
          tool_choice: 'auto',
          temperature: 0.6,
        }),
      });
    } catch (err) {
      /* 后端没起来时 fetch 抛的是 TypeError: Failed to fetch —— 转成人话 */
      if (err && err.name === 'AbortError') throw err;
      throw new Error('NO_BACKEND');
    }
    if (!r.ok) {
      /* 代理若把后端原文放在 body 里，带出来给用户看，比光一个 HTTP 状态码有用 */
      let detail = '';
      try { detail = (await r.text()).slice(0, 120); } catch (_) { /* 读不到就算了 */ }
      throw new Error(`HTTP ${r.status}${detail ? ` ${detail}` : ''}`);
    }
    try {
      return await r.json();
    } catch (_) {
      throw new Error('BAD_JSON');
    }
  }

  /* 有些代理把错误塞在 200 的 body 里（如 { error: {...} }），抓出来当报错 */
  function msgOf(choice) {
    const raw = choice && (choice.message || choice.delta);
    const c = raw && raw.content;
    return typeof c === 'string' ? c : '';
  }

  function isTimeout() { return timedOut; }

  function safeJson(s) {
    try { return JSON.parse(s || '{}'); } catch (_) { return {}; }
  }
  function niceError(err) {
    const m = String(err && err.message || err);
    if (m === 'NO_ENDPOINT') return '没填接口地址';
    if (m === 'NO_BACKEND') return '没接上接口';
    if (m === 'BAD_JSON') return '接口返回异常';
    if (/HTTP 401|403/.test(m)) return '接口没授权';
    if (/HTTP 404/.test(m)) return '接口地址不对';
    if (/HTTP 5\d\d/.test(m)) return '服务端出错';
    if (/EMPTY_REPLY/.test(m)) return '没答上来';
    if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return '连不上接口';
    return '出错了';
  }

  return { show, hide, ask, isOpen: () => open };
}
