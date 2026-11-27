/* ===== 吉祥物左右两栏：学院新闻 / 科研动态 =====
   数据：data/sse-feed.json（tools/fetch-sse.mjs 每天生成，来源中山大学软件工程学院）
   行为：
     · 只有两侧留白够放（不压到字符环）才出现，窗口变窄自动收起；
     · 轮播面板呼出、放大态、定制浮层、开场遮罩期间整组淡出；
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
  const time = el.querySelector('.feed-rail__time');
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

  if (time) time.textContent = fmtDate(section.items[0].date) ? `最新 ${fmtDate(section.items[0].date)}` : '';
  return true;
}

async function load() {
  if (!rails.length) return;
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

watch();
load();
