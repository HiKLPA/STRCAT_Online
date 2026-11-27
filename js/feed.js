/* ===== 吉祥物左右两栏：学院新闻 / 科研动态 =====
   数据：data/sse-feed.json（tools/fetch-sse.mjs 每天生成，来源中山大学软件工程学院）
   行为：
     · 只有两侧留白够放（不压到字符环）才出现，窗口变窄自动收起；
     · 轮播面板呼出、放大态、定制浮层、开场遮罩期间整组淡出；
     · 指针进入栏区时整块按唱片面板那套磁吸手感倾斜放大，离开弹性归位；
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

/* ===== 磁吸：复用歌单面板里唱片（.lock-stage）那套手感 =====
   指针进入栏区 → 先建透视，再 elastic.out 放大到 1.02；指针在栏内的归一化位置（-1 ~ 1）决定绕 Y / X 的
   倾角（靠近哪一侧，哪一侧朝观察者翘起），整块像被吸向指针；离开 → elastic 归位。
   倾斜写在 .feed-rail__shell 上，.feed-rail 自己留着居中位移与进出场过渡 —— 两层各写各的 transform，
   互不覆盖（与唱片面板把倾斜挂在下层 .lock-stage 的做法同源）。
   识别区用 window 的 pointermove 自测矩形：.feed-rail 是 pointer-events: none（不吃指针才不会挡住画布
   拖拽），收不到自己的 pointerenter；也只有自测矩形才能让卡片之间的间隙不断磁吸。 */
const MAGNET_PERSP = 1000;   // 透视距离（px，越小纵深越强）—— 与唱片同值
const MAGNET_SCALE = 1.02;   // 吸附时放大倍率 —— 与唱片同值
const MAGNET_TILT  = 5;      // 倾斜峰值（deg）：栏宽只有 210px，5° 已有纵深又不至于晃眼
const MAGNET_LEAN  = 1.2;    // 固定仰角（deg）：指针停在正中时 nx / ny 都是 0，光靠视差没有倾斜感
const MAGNET_PAD   = 6;      // 识别区外扩（px）：吃掉放大 2% 溢出矩形的那一圈，免得贴边反复收放

const magnet = rails.map(({ el }) => ({
  el, shell: el.querySelector('.feed-rail__shell'), engaged: false,
}));
const magnetOn = Boolean(window.gsap) && window.matchMedia('(prefers-reduced-motion: reduce)').matches === false;

function magnetEngage(m) {
  if (!magnetOn || m.engaged || !m.shell) return;
  m.engaged = true;
  /* scale: 1 必须显式写：GSAP 首次接管时会从 computed transform 解析当前值当起点，
     之后再写 scale 就是与它相乘 —— 显式声明 1 等于告诉它基准是中性态（唱片面板同款处理）。 */
  gsap.set(m.shell, { transformPerspective: MAGNET_PERSP, scale: 1 });
  gsap.to(m.shell, { scale: MAGNET_SCALE, duration: 1.2, ease: 'elastic.out(1, 0.6)', overwrite: 'auto' });
}

function magnetRelease(m) {
  if (!magnetOn || !m.engaged) return;
  m.engaged = false;
  gsap.to(m.shell, {
    rotationX: 0, rotationY: 0, scale: 1,
    duration: 1.0, ease: 'elastic.out(1, 0.6)', overwrite: 'auto',
  });
}

/* 立即归位（不留动画尾巴）：栏要淡出 / 收起时用，之后回到可见态不会残留倾角 */
function magnetSnap(m) {
  if (!m.engaged) return;
  m.engaged = false;
  gsap.killTweensOf(m.shell);
  gsap.set(m.shell, { rotationX: 0, rotationY: 0, scale: 1 });
}

function magnetTrack(e) {
  if (!magnetOn || e.buttons) return;      // 按住拖动时（画布轨道 / 触屏）不参与，避免抢手感
  for (const m of magnet) {
    if (!m.shell) continue;
    if (!m.el.classList.contains('is-on')) { magnetSnap(m); continue; }   // 已淡出：直接归位
    const r = m.el.getBoundingClientRect();
    if (!r.width) continue;
    if (e.clientX < r.left - MAGNET_PAD || e.clientX > r.right + MAGNET_PAD ||
        e.clientY < r.top - MAGNET_PAD || e.clientY > r.bottom + MAGNET_PAD) {
      magnetRelease(m);                    // 出了栏区：弹性归位
      continue;
    }
    if (!m.engaged) magnetEngage(m);       // 进入：建透视 + 弹性放大
    const nx = gsap.utils.clamp(-1, 1, (e.clientX - (r.left + r.width / 2)) / (r.width / 2));
    const ny = gsap.utils.clamp(-1, 1, (e.clientY - (r.top + r.height / 2)) / (r.height / 2));
    gsap.to(m.shell, {
      rotationY: -nx * MAGNET_TILT, rotationX: ny * MAGNET_TILT + MAGNET_LEAN,
      duration: 1.0, ease: 'power3.out', overwrite: 'auto',
    });
  }
}

if (magnetOn) {
  window.addEventListener('pointermove', magnetTrack, { passive: true });
  /* 指针移出窗口时收不到 pointermove，单独兜一次，免得停在倾斜态 */
  document.addEventListener('pointerleave', () => magnet.forEach(magnetRelease));
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
  /* 淡出 / 收起时把倾斜立即抹平：否则下次露面会带着上一轮的倾角慢慢弹回来 */
  if (hidden || !fitted) magnet.forEach(magnetSnap);
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
