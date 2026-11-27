/* 抓取中山大学软件工程学院「学院新闻」与「科研动态」，生成 data/sse-feed.json。
 *
 * 合规约定（改这个脚本时请保持）：
 *   · 每天只跑一次，总共不超过 10 个请求，请求间隔 ≥1.2s；
 *   · 只取标题、日期、原文链接、正文首图 URL —— 不下载正文、不转存图片；
 *   · UA 写明用途与站点地址；遇到 403 / 429 立刻停手，不重试、不绕防护；
 *   · 不抓教师主页、公示名单等含个人信息的页面。
 *
 * 用法：node tools/fetch-sse.mjs
 * 退出码：0 表示成功（内容没变也算成功），1 表示有致命错误。
 */

import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'https://sse.sysu.edu.cn';
const UA = 'STRCAT-SiteBot/1.0 (personal portfolio, 1 request/day; +https://hiklpa.github.io/STRCAT_Online/)';
const GAP_MS = 1200;
const TAKE = 3;                   // 每侧展示条数

const SECTIONS = [
  { key: 'news', label: '学院新闻', path: '/news' },
  { key: 'research', label: '科研动态', path: '/research/trends' },
];

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../data/sse-feed.json');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function decode(s) {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/\s+/g, ' ')
    .trim();
}

async function get(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9' },
    signal: AbortSignal.timeout(20000),
    redirect: 'follow',
  });
  if (res.status === 403 || res.status === 429) {
    throw new Error(`${res.status} ${url} —— 被限制访问，按约定停止`);
  }
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

/* 列表页：<li class="list-item…"><a href="/article/1114"><span class="date"><time datetime="…">…</time></span><p>标题</p></a></li> */
function parseList(html, limit) {
  const out = [];
  const items = html.match(/<li class="list-item[\s\S]*?<\/li>/g) || [];
  for (const li of items) {
    const href = li.match(/href="([^"]*\/article\/\d+)"/);
    const date = li.match(/<time[^>]*datetime="([^"]+)"/);
    const title = li.match(/<p[^>]*>([\s\S]*?)<\/p>/);
    if (!href || !title) continue;
    const text = decode(title[1]);
    if (!text) continue;
    out.push({
      title: text,
      url: new URL(href[1], BASE).href,
      date: date ? date[1].slice(0, 10) : '',
      image: null,
    });
    if (out.length >= limit) break;
  }
  return out;
}

/* 详情页首图：优先 <figure> 里的配图；跳过页尾的学院名、二维码、站点 logo */
const BAD_IMG = /(学院名称|二维码|qrcode|qr_|logo|sselogo)/i;

function parseFirstImage(html) {
  const body = html.match(/<article[\s\S]*?<\/article>/)?.[0] || html;
  const figures = body.match(/<figure[\s\S]*?<\/figure>/g) || [];
  for (const fig of figures) {
    const src = fig.match(/<img[^>]+src="([^"]+)"/)?.[1];
    if (src && !BAD_IMG.test(src)) return new URL(src, BASE).href;
  }
  const imgs = body.match(/<img[^>]+src="[^"]*\/inline-images\/[^"]+"/g) || [];
  for (const tag of imgs) {
    const src = tag.match(/src="([^"]+)"/)?.[1];
    if (src && !BAD_IMG.test(src)) return new URL(src, BASE).href;
  }
  return null;
}

function nowShanghai() {
  const d = new Date(Date.now() + 8 * 3600e3);
  return d.toISOString().replace(/\.\d{3}Z$/, '+08:00');
}

async function main() {
  const feed = {
    source: { name: '中山大学软件工程学院', url: `${BASE}/` },
    updatedAt: nowShanghai(),
    sections: {},
  };

  let requests = 0;
  const seen = new Set();          // 两个栏目偶尔共用同一条（如学术会议），只在一侧出现
  for (const sec of SECTIONS) {
    const listHtml = await get(BASE + sec.path);
    requests++;
    const items = parseList(listHtml, TAKE + 2)
      .filter((i) => !seen.has(i.url))
      .slice(0, TAKE);
    items.forEach((i) => seen.add(i.url));

    for (const item of items) {
      await sleep(GAP_MS);
      try {
        const artHtml = await get(item.url);
        requests++;
        item.image = parseFirstImage(artHtml);
      } catch (err) {
        console.warn(`[warn] ${item.url}: ${err.message}`);
        item.image = null;
      }
    }

    feed.sections[sec.key] = { label: sec.label, items };
    console.log(`${sec.label}: ${items.length} 条，带图 ${items.filter((i) => i.image).length} 条`);
  }

  console.log(`共 ${requests} 个请求`);

  /* 只在条目真的有变化时写文件：避免每天产生一条无意义的提交 */
  let previous = null;
  try {
    previous = JSON.parse(await readFile(OUT, 'utf8'));
  } catch { /* 首次运行，没有旧文件 */ }
  if (previous && JSON.stringify(previous.sections) === JSON.stringify(feed.sections)) {
    console.log('内容无变化，跳过写入');
    return;
  }

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, `${JSON.stringify(feed, null, 2)}\n`, 'utf8');
  console.log(`已写入 ${OUT}`);
}

main().catch((err) => {
  console.error(`[fatal] ${err.message}`);
  process.exit(1);
});
