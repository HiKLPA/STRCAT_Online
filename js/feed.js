/* ===== 吉祥物左右两栏：学院新闻 / 科研动态 =====
   数据：data/sse-feed.json（tools/fetch-sse.mjs 每天生成，来源中山大学软件工程学院）
   行为：
     · 只有两侧留白够放（不压到字符环）才出现，窗口变窄自动收起；
     · 轮播面板呼出、放大态、定制浮层、开场遮罩期间整组淡出；
     · 指针进入某条新闻时，那张卡按唱片那套磁吸手感倾斜放大，移出弹性归位；
     · 每条只渲染标题 / 日期 / 原文首图，点击新标签打开学院官网原文。 */

const FEED_URL = './data/sse-feed.json';

/* 字符环半径 2.0 世界单位、相机 z=5 / fov 45° → 半高 2.071，故半径 ≈ 半高的 0.966 倍；
   再乘 1.08 留出 hover 放大（1.1×）的余量，避免猫一悬停就压到栏上 */
const RING_RATIO = 0.966 * 1.08;
const EDGE = 26;          // 两栏离视口边缘的距离（与 css/feed.css 的 left/right 一致）
const GAP = 16;           // 栏与字符环之间至少留的空隙

const rails = [
  { el: document.getElementById('feedNews'), key: 'news' },
  { el: document.getElementById('feedResearch'), key: 'research' },
].filter((r) => r.el);

let fitted = false;       // 当前宽度是否放得下
let hasData = false;

/* ===== 单条磁吸：复用歌单面板里唱片（.lock-stage）那套手感，作用对象换成每条新闻卡 =====
   指针进入某条 → 先建透视，再 elastic.out 放大到 1.03；指针在这条卡内的归一化位置（-1 ~ 1）决定绕 Y / X 的
   倾角（靠近哪一侧，哪一侧朝观察者翘起），卡面像被吸向指针；换条 / 移出 / 栏淡出 → 弹性归位。
   监听挂在 .feed-rail 上靠冒泡（卡片自己有 pointer-events，栏本身没有），与歌单行挂 .lock-player__list 同理；
   卡与卡之间那 14px 间隙命中不到卡片 → 天然的移出，正好和歌单行离开一行的行为一致。 */
const ITEM_PERSP = 1000;   // 透视距离（px，越小纵深越强）—— 与唱片同值
const ITEM_SCALE = 1.03;   // hover 放大倍率（比唱片 1.02 略大：卡片只有 196px 宽）
const ITEM_TILT  = 8;      // 倾斜峰值（deg）—— 与歌单行同值

let hoverItem = null;      // 当前吸附的卡片
let hoverBox = null;       // 它的静止矩形：进入时量一次，指针移动期间不再量（实时 rect 会「跟着走 → 倾角变小 → 回弹」地抖）

const magnetOn = Boolean(window.gsap) && window.matchMedia('(prefers-reduced-motion: reduce)').matches === false;

/* 进入某条：建透视 + 弹性放大 */
function itemMagnetEnter(item) {
  /* scale: 1 必须显式写：GSAP 首次接管时会从 computed transform 解析当前值当起点，
     之后再写 scale 就是与它相乘 —— 显式声明 1 等于告诉它基准是中性态（唱片面板同款处理）。 */
  gsap.set(item, { transformPerspective: ITEM_PERSP, scale: 1 });
  gsap.to(item, { scale: ITEM_SCALE, duration: 0.6, ease: 'elastic.out(1, 0.5)', overwrite: 'auto' });
}

/* 弹性归位（有动画）：指针换到别的卡 / 移出栏 */
function itemMagnetRelease(item) {
  if (!item) return;
  gsap.to(item, {
    rotationX: 0, rotationY: 0, scale: 1,
    duration: 0.7, ease: 'elastic.out(1, 0.4)', overwrite: 'auto',
  });
}

/* 立即归位（不留动画尾巴）：栏要淡出 / 收起时用，否则下次露面会带着旧倾角弹回来 */
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
      duration: 0.45, ease: 'power3.out', overwrite: 'auto',
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

function muted() {
  const carousel = document.querySelector('.carousel');
  const customize = document.getElementById('customize');
  const gate = document.getElementById('opening');
  return Boolean(
    (gate && getComputedStyle(gate).visibility !== 'hidden') ||      // 开场视频还盖着
    carousel?.classList.contains('is-open') ||
    carousel?.classList.contains('is-expanded') ||
    (customize && getComputedStyle(customize).visibility === 'visible')
  );
}

function sync() {
  const hidden = muted();
  rails.forEach(({ el }) => {
    el.classList.toggle('is-on', fitted && hasData && !hidden);
    el.classList.toggle('is-muted', hidden);
  });
  /* 淡出 / 收起时把卡片的倾斜立即抹平：否则下次露面会带着上一轮的倾角慢慢弹回来 */
  if (hidden || !fitted) itemMagnetSnap();
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

let rafId = 0;
window.addEventListener('resize', () => {
  if (rafId) return;
  rafId = requestAnimationFrame(() => { rafId = 0; layout(); });
});

/* 等开场遮罩淡完再拉数据：六张首图约 3.4MB，别和入场动画抢带宽 */
function start() {
  const gate = document.getElementById('opening');
  const ready = () => !gate || getComputedStyle(gate).visibility === 'hidden';
  if (ready()) {
    load();
    return;
  }
  const mo = new MutationObserver(() => {
    if (!ready()) return;
    mo.disconnect();
    setTimeout(load, 1200);      // 入场动画约 1.5s，留出收尾
  });
  mo.observe(gate, { attributes: true, attributeFilter: ['style', 'class'] });
  setTimeout(() => { mo.disconnect(); load(); }, 8000);   // 兜底：遮罩异常时也别一直不加载
}

watch();
start();
