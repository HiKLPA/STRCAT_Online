/* ===================================================================
   STRCAT 吉祥物 AI 代理 —— Cloudflare Worker
   把浏览器请求转发给智谱，API Key 只存在 Worker 的密钥里，不进前端。

   部署（三条命令，都要在 worker/ 目录里跑）：
     npm i -g wrangler
     wrangler login
     wrangler secret put ZHIPU_KEY      ← 粘贴智谱 API Key（sk- 开头）
     wrangler deploy                    ← 部署后会打印出 *.workers.dev 地址

   把打印出来的地址填进 index.html 里的 AI_ENDPOINT。

   为什么必须有这一层：浏览器直接调智谱会把 Key 暴露给任何打开网页的人
   （F12 就能看到），拿去盗刷。Key 放服务端是唯一合规做法。

   安全措施（这是个公开接口，必须防滥用）：
     · 只允许本站域名跨域，其它站点拿不到响应
     · 请求体大小上限、消息条数上限 —— 挡掉往里灌超长内容刷额度
     · 只放行我们自己的两个工具（get_weather / get_time 在前端执行，模型只负责决定调不调）
=================================================================== */

const UPSTREAM = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';

/* 允许跨域的来源。部署后拿到自己的域名，加进来（用逗号分隔）。
   ⚠ 设为 '*' 就等于谁都能白嫖你的额度，别这么干。 */
const ALLOW_ORIGINS = [
  'http://localhost:8000',
  'http://127.0.0.1:8000',
  // 'https://你的域名.workers.dev',
];

/* 防御性上限（正常用户碰不到，专门挡脚本刷） */
const MAX_BODY_BYTES = 32 * 1024;   // 请求体 ≤32KB
const MAX_MESSAGES   = 12;          // 消息条数 ≤12
const MAX_CHARS      = 4000;        // 所有消息正文合计字符数

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || '';

    /* --- CORS --- */
    const allow = ALLOW_ORIGINS.includes(origin) ? origin : ALLOW_ORIGINS[0];
    const cors = {
      'Access-Control-Allow-Origin': allow,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin',
    };

    /* 浏览器预检 —— 必须在做任何别的事之前回掉 */
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== 'POST') {
      return json({ error: '只接受 POST' }, 405, cors);
    }

    /* --- 密钥检查 --- */
    if (!env.ZHIPU_KEY) {
      return json({ error: '代理没配 ZHIPU_KEY（用 wrangler secret put ZHIPU_KEY 设置）' }, 500, cors);
    }

    /* --- 体积与内容校验 --- */
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) {
      return json({ error: '请求过大' }, 413, cors);
    }

    let body;
    try {
      body = JSON.parse(raw);
    } catch (_) {
      return json({ error: '请求不是合法 JSON' }, 400, cors);
    }

    const msgs = Array.isArray(body.messages) ? body.messages : [];
    if (!msgs.length || msgs.length > MAX_MESSAGES) {
      return json({ error: '消息条数不对' }, 400, cors);
    }
    const chars = msgs.reduce((n, m) => n + String(m && m.content || '').length, 0);
    if (chars > MAX_CHARS) {
      return json({ error: '内容过长' }, 413, cors);
    }

    /* 白名单：模型只能调这两个工具。前端本来就会自己执行它们，
       这里挡的是「模型被骗着去调别的函数」这类注入尝试。 */
    const tools = (Array.isArray(body.tools) ? body.tools : []).filter(
      (t) => t && t.function && ['get_weather', 'get_time'].includes(t.function.name)
    );

    /* --- 转发 --- */
    const payload = {
      model: env.MODEL || 'glm-4-flash',
      messages: msgs,
      tools,
      tool_choice: tools.length ? 'auto' : 'none',
      temperature: 0.6,
      max_tokens: 512,          // 吉祥物只答一两句话，封顶挡刷额度
    };

    let res;
    try {
      res = await fetch(UPSTREAM, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.ZHIPU_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      return json({ error: `连不上智谱：${err && err.message || err}` }, 502, cors);
    }

    /* 原样回传上游正文 —— 前端 niceError() 会把 HTTP 状态翻成人话 */
    const text = await res.text();
    return new Response(text, {
      status: res.status,
      headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' },
    });
  },
};

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' },
  });
}
