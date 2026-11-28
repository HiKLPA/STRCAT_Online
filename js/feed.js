/* ===== 吉祥物左右两栏：学院新闻 / 科研动态 =====
   数据：data/sse-feed.json（tools/fetch-sse.mjs 每天生成，来源中山大学软件工程学院）
   行为：
     · 只有两侧留白够放（不压到字符环）才出现，窗口变窄自动收起；
     · 进出场直接调用定制浮层左右子面板的那份实现（index.html 的 window.sidePanels，同一套函数，
       不是复制参数）—— 打开页面时自两侧滑入并弹性撑开，底部面板呼出、定制浮层打开时缩着滑出去，
       面板收完 / 浮层滑走后再回来；
     · 指针进入某条新闻时，那张卡按唱片那套磁吸手感倾斜放大，移出弹性归位；
     · 每条只渲染标题 / 日期 / 原文首图，点击新标签打开学院官网原文。 */

const FEED_URL = './data/sse-feed.json';

/* 字符环半径 2.0 世界单位、相机 z=5 / fov 45° → 半高 2.071，故半径 ≈ 半高的 0.966 倍；
   再乘 1.08 留出 hover 放大（1.1×）的余量，避免猫一悬停就压到栏上 */
const RING_RATIO = 0.966 * 1.08;
const EDGE = 26;          // 两栏离视口边缘的距离（与 css/feed.css 的 left/right 一致）
const GAP = 16;           // 栏与字符环之间至少留的空隙

/* dir 决定弹入弹走的方向：左栏去左边、右栏去右边 */
const rails = [
  { el: document.getElementById('feedNews'), key: 'news', dir: -1 },
  { el: document.getElementById('feedResearch'), key: 'research', dir: 1 },
].filter((r) => r.el).map((r) => ({ ...r, shell: r.el.querySelector('.feed-rail__shell') }));

let fitted = false;       // 当前宽度是否放得下
let hasData = false;

/* ===== 单条磁吸：复用歌单面板里唱片（.lock-stage）那套手感，作用对象换成每条新闻卡 =====
   指针进入某条 → 先建透视，再 elastic.out 放大到 1.03；指针在这条卡内的归一化位置（-1 ~ 1）决定绕 Y / X 的
   倾角（靠近哪一侧，哪一侧朝观察者翘起），卡面像被吸向指针；换条 / 移出 / 栏退场 → 弹性归位。
   监听挂在 .feed-rail 上靠冒泡（卡片自己有 pointer-events，栏本身没有），与歌单行挂 .lock-player__list 同理；
   卡与卡之间那 14px 间隙命中不到卡片 → 天然的移出，正好和歌单行离开一行的行为一致。 */
const ITEM_PERSP = 1000;   // 透视距离（px，越小纵深越强）—— 与唱片同值
const ITEM_SCALE = 1.03;   // hover 放大倍率（比唱片 1.02 略大：卡片只有 196px 宽）
const ITEM_TILT  = 8;      // 倾斜峰值（deg）—— 与歌单行同值
/* 时长（s）与弹性周期：只影响这两栏的卡片，唱片（1.2 / 1.0 / 1.0，周期 0.6 / 0.4）与歌单行
   （0.6 / 0.45 / 0.7）各自的数值不动。
   elastic.out 是「前段冲、后段晃」的形状，光拉总时长只会拖长尾巴，观感还是很快 —— 周期才是
   让第一下峰值往后推的旋钮（周期越大，回弹摆得越慢），所以这两栏的周期都比唱片大一档。 */
const ITEM_ENTER_DUR = 1.0;    // 进入：弹性放大到 ITEM_SCALE
const ITEM_ENTER_WOBBLE = 0.7; // 进入的弹性周期（越大第一下峰值越晚、回弹越软）
const ITEM_TILT_DUR = 0.7;     // 跟随：每次改写倾角的时长
const ITEM_EXIT_DUR = 1.15;    // 归位：弹回原尺寸与水平位
const ITEM_EXIT_WOBBLE = 0.5;  // 归位的弹性周期

let hoverItem = null;      // 当前吸附的卡片
let hoverBox = null;       // 它的静止矩形：进入时量一次，指针移动期间不再量（实时 rect 会「跟着走 → 倾角变小 → 回弹」地抖）

const magnetOn = Boolean(window.gsap) && window.matchMedia('(prefers-reduced-motion: reduce)').matches === false;

/* 进入某条：建透视 + 弹性放大 */
function itemMagnetEnter(item) {
  /* scale: 1 必须显式写：GSAP 首次接管时会从 computed transform 解析当前值当起点，
     之后再写 scale 就是与它相乘 —— 显式声明 1 等于告诉它基准是中性态（唱片面板同款处理）。 */
  gsap.set(item, { transformPerspective: ITEM_PERSP, scale: 1 });
  gsap.to(item, { scale: ITEM_SCALE, duration: ITEM_ENTER_DUR, ease: `elastic.out(1, ${ITEM_ENTER_WOBBLE})`, overwrite: 'auto' });
}

/* 弹性归位（有动画）：指针换到别的卡 / 移出栏 */
function itemMagnetRelease(item) {
  if (!item) return;
  gsap.to(item, {
    rotationX: 0, rotationY: 0, scale: 1,
    duration: ITEM_EXIT_DUR, ease: `elastic.out(1, ${ITEM_EXIT_WOBBLE})`, overwrite: 'auto',
  });
}

/* 立即归位（不留动画尾巴）：栏要退场 / 收起时用，否则下次露面会带着旧倾角弹回来 */
function itemMagnetSnap() {
  if (!hoverItem) return;
  const item = hoverItem;
  hoverItem = null;
  hoverBox = null;
  if (!magnetOn) return;
  gsap.killTweensOf(item);
  gsap.set(item, { rotationX: 0, rotationY: 0, scale: 1 });
}

function bindMagnet(el) {
  el.addEventListener('pointermove', (e) => {
    if (!magnetOn || e.buttons) return;      // 按住拖动时（画布轨道 / 触屏）不参与，避免抢手感
    const item = e.target.closest ? e.target.closest('.feed-rail__item') : null;
    if (item !== hoverItem) {                // 换卡：旧卡弹回、新卡放大
      itemMagnetRelease(hoverItem);
      hoverItem = item;
      hoverBox = item ? item.getBoundingClientRect() : null;
      if (item) itemMagnetEnter(item);
    }
    if (!item || !hoverBox || !hoverBox.width) return;
    /* 与唱片同一套换算：指针越靠边，卡面朝该边的倾角越大 */
    const nx = gsap.utils.clamp(-1, 1, (e.clientX - (hoverBox.left + hoverBox.width / 2)) / (hoverBox.width / 2));
    const ny = gsap.utils.clamp(-1, 1, (e.clientY - (hoverBox.top + hoverBox.height / 2)) / (hoverBox.height / 2));
    gsap.to(item, {
      rotationY: -nx * ITEM_TILT, rotationX: ny * ITEM_TILT,
      duration: ITEM_TILT_DUR, ease: 'power3.out', overwrite: 'auto',
    });
  });

  /* 离开整栏（含走进卡片之间的间隙）：当前这张弹性归位 */
  el.addEventListener('pointerleave', () => {
    itemMagnetRelease(hoverItem);
    hoverItem = null;
    hoverBox = null;
  });
}

if (magnetOn) rails.forEach(({ el }) => bindMagnet(el));

/* ===== 进出场：直接调用定制浮层那对左右子面板的实现（index.html 的 window.sidePanels）=====
   行程、时长、曲线、起手比例、错峰都不在这里复制一份：sidePanels.enter / exit / park 就是定制面板
   用的那几个函数（位移 + 淡入走 panelOut，scaleX / scaleY 走 elastic.out(1, 0.75)，退出一条补间同拍）。
   这里只决定「从哪到哪」——资讯栏静止位在屏幕边缘，所以是 45vw → 0；定制面板是 gap + 45vw → gap。 */
const sidePanels = window.sidePanels;
/* 弹回前的等待：底部面板自身要 0.4 秒才收紧，留 0.5 秒等它落定再让两栏回来，两段动势不叠在一起；
   定制浮层留 0.4 —— 从浮层退回面板时 0.35 秒后会重新呼出轮播，得等它先亮起来，
   否则两栏会先弹进来再被推出去，闪一下。开关按钮（default）不等待，按了就回。 */
const WAIT = { panel: 0.5, overlay: 0.4 };
const SUPPRESS_MS = 1200;       // 点「定制 / 自定义」后的静默期：这段时间内一律不弹入

let shown = false;          // 是否处于显示态（含动画中）
let enterCall = null;       // 排期中的弹入
let enterRuns = [];         // 正在跑的入场时间线（每条一列，方便整组掐掉）
let hideReason = 'default'; // 上一次退场的原因：决定弹回要等多久
let suppressUntil = 0;      // 静默期截止时间（performance.now 基准）
let userOn = true;          // 顶栏开关：用户想不想看到这两栏（关掉就一直收起，直到再按一次）
let toggleBtn = null;       // 顶栏那枚开关按钮

function cancelEnter() {
  if (enterCall) { enterCall.kill(); enterCall = null; }
  enterRuns.forEach((tl) => tl.kill());
  enterRuns = [];
}

/* 顶栏那枚按钮的点亮状态 = 两栏此刻是否真在屏上：
   弹入时亮，退出（不论是自己关掉，还是给底部面板 / 定制浮层让位）时立刻灭，弹回后再自动亮起来 */
function syncToggle() {
  if (toggleBtn) toggleBtn.setAttribute('aria-pressed', String(shown));
}

function enterRails() {
  if (shown || !rails.length) return;
  shown = true;
  syncToggle();
  if (!sidePanels) { rails.forEach(({ el }) => el.classList.add('is-on')); return; }
  enterRuns = [];
  const slide = sidePanels.slide();
  rails.forEach((rail, i) => {
    if (!rail.shell) return;
    gsap.killTweensOf(rail.shell);
    enterRuns.push(sidePanels.enter(rail.shell, rail.dir, slide, 0, i * sidePanels.stagger));
  });
  /* 位移落定（0.6 + 0.08 错峰）就放开命中；弹性撑开最后那点尾巴不必连点击一起等 */
  const last = enterRuns[enterRuns.length - 1];
  if (last) {
    last.eventCallback('onComplete', () => {
      enterRuns = [];
      rails.forEach(({ el }) => el.classList.add('is-on'));
    });
  }
}

function exitRails() {
  if (!shown) return;
  shown = false;
  syncToggle();
  cancelEnter();
  itemMagnetSnap();
  rails.forEach(({ el }) => el.classList.remove('is-on'));
  if (!sidePanels) return;
  /* 与定制面板一致：两栏同时收，不加错峰 */
  const slide = sidePanels.slide();
  rails.forEach((rail) => {
    if (!rail.shell) return;
    gsap.killTweensOf(rail.shell);
    sidePanels.exit(rail.shell, rail.dir, 0, slide);
  });
}

/* 尺寸变化时把收起态的壳重新摆回行程起点（不播动画）：否则窗口变宽后旧的位移量不够，会露出半截 */
function parkRails() {
  if (!sidePanels) return;
  const slide = sidePanels.slide();
  rails.forEach((rail) => {
    if (rail.shell) sidePanels.park(rail.shell, rail.dir, slide);
  });
}

function railWidth() {
  return Math.round(Math.min(230, Math.max(180, window.innerWidth * 0.14)));
}

function layout() {
  if (!rails.length) return;
  const w = railWidth();
  const ringPx = (RING_RATIO * window.innerHeight) / 2;
  fitted = window.innerWidth / 2 - ringPx - EDGE - GAP >= w;
  const compact = window.innerHeight < 760;      // 矮屏只放两条，免得顶到顶栏
  rails.forEach(({ el }) => {
    el.style.setProperty('--rail-w', `${w}px`);
    el.classList.toggle('is-compact', compact);
  });
  sync();
}

/* 当前该退场的原因：底部面板（含放大态）> 定制浮层 > 开场遮罩；都没有就返回 default */
function hideReasonNow() {
  const carousel = document.querySelector('.carousel');
  if (carousel && (carousel.classList.contains('is-open') || carousel.classList.contains('is-expanded'))) return 'panel';
  const customize = document.getElementById('customize');
  if (customize && getComputedStyle(customize).visibility === 'visible') return 'overlay';
  const gate = document.getElementById('opening');
  if (gate && getComputedStyle(gate).visibility !== 'hidden') return 'gate';
  return 'default';
}

function sync() {
  const reason = hideReasonNow();
  const visible = fitted && hasData && userOn && reason === 'default';

  if (!visible) {
    if (reason !== 'default') hideReason = reason;
    cancelEnter();      // 排期中的弹入也要掐掉，否则退场后它还会自己弹进来
    exitRails();
    return;
  }

  if (shown || enterCall || enterRuns.length) return;

  /* 静默期（刚点过定制入口）：到点再重新判断一次，别在这段缝里弹进来 */
  const quiet = suppressUntil - performance.now();
  if (quiet > 0) {
    enterCall = gsap.delayedCall(quiet / 1000, () => {
      enterCall = null;
      hideReason = 'default';
      sync();
    });
    return;
  }

  const wait = WAIT[hideReason] ?? 0;
  if (wait > 0) enterCall = gsap.delayedCall(wait, () => { enterCall = null; enterRails(); });
  else enterRails();
}

/* ===== 顶栏开关：手动收起 / 展开两栏 =====
   按一下改「用户想不想看」；按钮点亮与否跟着实际显示走（见 syncToggle），所以面板让位收起时它自己会灭。
   关掉要立刻收（连排期中的弹入一起掐掉），再按一次按常规等待重新弹回。 */
function setUserOn(on) {
  userOn = !!on;
  if (!userOn) { cancelEnter(); exitRails(); syncToggle(); return; }
  hideReason = 'default';
  sync();
  syncToggle();     // 被面板挡着时保持灭着，等它弹回来再亮
}

function bindToggle() {
  toggleBtn = document.querySelector('[data-feed-toggle]');
  if (!toggleBtn) return;
  syncToggle();
  /* 按当前点亮状态取反：面板让位导致按钮灭着时，点一下表达的是「我要看」，不是把意愿关掉 */
  toggleBtn.addEventListener('click', () => setUserOn(toggleBtn.getAttribute('aria-pressed') !== 'true'));
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00+08:00`);
  if (Number.isNaN(d.getTime())) return iso;
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return d.getFullYear() === new Date().getFullYear() ? `${mm}-${dd}` : `${d.getFullYear()}-${mm}-${dd}`;
}

function renderSection(el, section) {
  const list = el.querySelector('.feed-rail__list');
  if (!list || !section?.items?.length) return false;

  list.replaceChildren();
  for (const item of section.items.slice(0, 3)) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.className = 'feed-rail__item';
    a.href = item.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';

    if (item.image) {
      const img = document.createElement('img');
      img.className = 'feed-rail__thumb';
      img.src = item.image;
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.referrerPolicy = 'no-referrer';
      a.append(img);
    } else {
      const ph = document.createElement('span');
      ph.className = 'feed-rail__thumb feed-rail__thumb--empty';
      a.append(ph);
    }

    const title = document.createElement('p');
    title.className = 'feed-rail__title';
    title.textContent = item.title;
    a.append(title);

    const date = document.createElement('span');
    date.className = 'feed-rail__date';
    date.textContent = fmtDate(item.date);
    a.append(date);

    li.append(a);
    list.append(li);
  }

  return true;
}

let loaded = false;

async function load() {
  if (!rails.length || loaded) return;
  loaded = true;
  try {
    const res = await fetch(FEED_URL, { cache: 'no-cache' });
    if (!res.ok) return;
    const data = await res.json();
    let any = false;
    for (const { el, key } of rails) any = renderSection(el, data.sections?.[key]) || any;
    hasData = any;
  } catch {
    /* 取不到数据（首屏离线 / 还没生成过）就保持隐藏，不影响页面其余部分 */
  }
  layout();
}

/* 状态监听：轮播 / 定制浮层 / 开场遮罩任一变化都重新判断 */
function watch() {
  const carousel = document.querySelector('.carousel');
  const customize = document.getElementById('customize');
  const gate = document.getElementById('opening');
  const mo = new MutationObserver(sync);
  if (carousel) mo.observe(carousel, { attributes: true, attributeFilter: ['class'] });
  if (customize) mo.observe(customize, { attributes: true, attributeFilter: ['style', 'class'] });
  /* 遮罩淡出只改自身 inline style（visibility），淡完才 remove —— 两处都要看，否则会一直等到移除才出现 */
  if (gate) mo.observe(gate, { attributes: true, attributeFilter: ['style', 'class'] });
  new MutationObserver(sync).observe(document.body, { childList: true });
}

/* 两个定制入口点下去要经过 收回轮播 → 等 0.35s → 弹浮层 这么一段缝，
   其间 is-open 已经移除、浮层又还没 visible，不拦一下两栏就会弹进来再被推出去。
   捕获阶段先记时间戳，业务回调里的状态变化照常触发 sync，只是被静默期挡住。 */
document.addEventListener('click', (e) => {
  if (!e.target.closest || !e.target.closest('[data-customize], #customizeTrigger')) return;
  suppressUntil = performance.now() + SUPPRESS_MS;
  cancelEnter();
  exitRails();
}, true);

let rafId = 0;
window.addEventListener('resize', () => {
  if (rafId) return;
  rafId = requestAnimationFrame(() => {
    rafId = 0;
    layout();
    if (!shown && !enterCall) parkRails();
  });
});

/* 等开场遮罩淡完再拉数据：六张首图约 3.4MB，别和入场动画抢带宽 */
function start() {
  const gate = document.getElementById('opening');
  const ready = () => !gate || getComputedStyle(gate).visibility === 'hidden';
  if (ready()) {
    parkRails();
    load();
    return;
  }
  parkRails();
  const mo = new MutationObserver(() => {
    if (!ready()) return;
    mo.disconnect();
    setTimeout(load, 900);       // 入场动画约 1.5s，留出收尾再弹入
  });
  mo.observe(gate, { attributes: true, attributeFilter: ['style', 'class'] });
  setTimeout(() => { mo.disconnect(); load(); }, 8000);   // 兜底：遮罩异常时也别一直不加载
}

bindToggle();
watch();
start();
