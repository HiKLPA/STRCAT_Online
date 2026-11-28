# STRCAT Online

An interactive platform for real-time conversations with STRCAT, a lively and customizable mascot inspired by the `strcat()` function of C.

一个支持高度定制的吉祥物网站：Three.js渲染的三渲二小猫STRCAT悬浮在页面中央，绕它一圈是字符环；点击本体即可与它对话，回答会写在那圈字符上。点击底部弹窗按钮会弹出四个面板，分别承载形象介绍、衍生文创介绍、定制菜单与锁屏音乐播放器。

在线预览：<https://hiklpa.github.io/STRCAT_Online/>（启用 GitHub Pages 后生效，见文末）

---

## 运行

页面用了 ES module、`fetch` 与 GLB 模型，`file://` 直接双击打不开，必须起一个本地服务：

```bash
# 任选其一，在本目录下执行
python -m http.server 8000
npx serve .
```

然后访问 <http://localhost:8000>。

首次进入会先播一段开场视频，点页面任意处跳过。建议 1440×900 以上窗口，最小适配宽度 1180px。

---

## 功能

| 入口 | 内容 |
|---|---|
| 3D 本体 | 拖拽旋转、滚轮缩放；点击呼出对话输入框，Esc 或点空白收起 |
| AI 对话 | 智谱 GLM-4-Flash，支持天气与时间两个工具调用，答案写进外围字符环（自动分段 + 自动字号） |
| 顶栏菜单 | 五枚入口：资讯（左右两栏开关）在介绍左侧，其后是介绍、衍生、定制、锁屏；面板以 squash & stretch 浮出 |
| 面板一 介绍 | 标题字块 + 三色条纹，介绍吉祥物的造型与配色 |
| 面板二 衍生 | 票根、条幅、明信片、鼠标样式等文创说明 |
| 面板三 定制 | 跳转定制浮层：形态、配色、表情、字符内容、头饰（方凳 / 键盘） |
| 面板四 锁屏 | 唱片播放器：本地歌单导入、点选、拖拽排序、可拖动进度条，曲名与进度同步到顶栏迷你播放器 |
| 常驻迷你播放器 | 顶栏居中，内圈白描边走进度，随顶栏一起在放大态退出 |
| 左右两栏 | 吉祥物两侧：学院新闻 / 科研动态，只显示标题、日期与原文首图，点击跳转学院官网；数据每天 07:10 自动更新，顶栏最左那枚「资讯」按钮可随时收起 / 展开 |

定制面板改的是同一个 3D 对象：颜色走 `--red` / `--yellow` / `--blue`，头饰换的是 `models/` 下的 GLB。刷新即回到默认形象，不留存档。

---

## 目录

```
index.html          # HTML + 三段内联 CSS（公共样式）+ 内联 module JS（3D 场景、动画、播放器）
css/
  topbar.css        # 顶栏、菜单、迷你播放器
  panel-1.css       # 介绍面板
  panel-2.css       # 衍生面板
  panel-3.css       # 定制面板 + 触发按钮 + 拖拽
  panel-4.css       # 锁屏播放器
  ai-chat.css       # 对话输入框
  feed.css          # 吉祥物左右两栏（学院新闻 / 科研动态）
js/
  ai-chat.js        # AI 对话：输入框 DOM、两轮 function calling、字符环分段
  ai-config.js      # 本地密钥（不进 git）
  ai-config.example.js  # 上面那份的模板
  feed.js           # 左右两栏：读 data/sse-feed.json 渲染，左右弹入弹走，单卡磁吸
data/
  sse-feed.json     # 学院新闻 / 科研动态的最新条目（由 GitHub Actions 每天生成）
tools/
  fetch-sse.mjs     # 抓取脚本：2 个列表页 + 最新 6 篇详情，每天一次
.github/workflows/
  sse-feed.yml      # 每天 07:10（北京时间）跑上面的脚本并提交数据
lib/                # three.js r160 / OrbitControls / GLTFLoader、gsap 3.12.5、CustomEase、ScrollTrigger
models/             # 头饰模型（Blender 导出）：stool.glb、keyboard.glb
icon/               # favicon、唱片卡面
opening/            # 开场视频
worker/             # 可选：Cloudflare Worker 代理，把 API Key 挪到服务端
```

Three.js 走 importmap 指向 `lib/`，不依赖 CDN；只有 Google Fonts 是外链。

---

## AI 接口配置

密钥不在仓库里。复制模板后填入自己的 key：

```bash
cp js/ai-config.example.js js/ai-config.js
```

`js/ai-config.js` 已被 `.gitignore` 排除。两种接法：

**本地自用（直连）** — key 会出现在前端，只适合自己看。填 `apiKey` 即可，`endpoint` 保持智谱官方地址。

**公网发布（走代理）** — 把 `endpoint` 换成 `worker/` 部署出来的地址（结尾补 `/chat`），`apiKey` 留空。密钥只存在 Cloudflare 侧，浏览器拿不到。部署步骤见 [`worker/README.md`](worker/README.md)。

没有配置时，点击本体只会提示还没配好接口，页面其余部分不受影响。

---

## 学院新闻 / 科研动态

吉祥物左右两栏展示学院官网的「学院新闻」与「科研动态」，只保留标题、日期与原文首图，点击在新标签打开原文；栏目标题本身链到对应栏目页。指针进入某一条时，那张卡按唱片面板那套磁吸手感倾斜放大（GSAP perspective + elastic），移出弹性归位，见 `js/feed.js` 的 `bindMagnet`。

两栏的进出场不复制参数，直接调用定制浮层那对左右子面板的同一份实现：`index.html` 把 `sideEnter` / `sideExit` / `sidePark`、行程（45vw）、时长（进场 0.6s、弹性撑开 0.65s、退出 0.4s）、起手比例（30% / 75%）、曲线（panelOut / elastic.out(1, 0.75) / panelIn）与 0.08s 错峰一起挂在 `window.sidePanels` 上，`js/feed.js` 只传「从哪到哪」——资讯栏静止位贴屏幕边缘，所以是 45vw → 0，定制面板是 gap + 45vw → gap。页面打开时自动从两侧滑入；底部面板呼出、定制浮层打开时缩着滑出去，面板一开始收两栏就跟着回来（与定制浮层同一节奏，只留浮层退回面板时那 0.4 秒等轮播先亮起来）。点「定制 / 自定义」进浮层的那 1.2 秒里保持静默，避免轮播已收、浮层未开的那段缝隙里闪一下。

顶栏最左那枚「资讯」按钮是手动开关（`data-feed-toggle`，逻辑在 `js/feed.js` 的 `setUserOn`）：关掉后两栏立刻收起、期间不再自动弹回，再按一次恢复；它管的是意愿而不是当下的可见性，所以底部面板呼出期间两栏让位时按钮保持点亮。

数据来自 `https://sse.sysu.edu.cn/news` 与 `/research/trends`。站点没有 RSS 或 JSON 接口，也不发 CORS 头，所以不能在浏览器里直接抓；改为由 `.github/workflows/sse-feed.yml` 每天 07:10（北京时间）跑 `tools/fetch-sse.mjs`，把结果写进 `data/sse-feed.json` 并提交。页面同源读取这份 JSON，不需要任何后端。

手动更新一次：

```bash
node tools/fetch-sse.mjs
```

抓取遵守的边界：每天一次、共 8 个请求、间隔 1.2 秒；只取标题、日期、原文链接和正文首图 URL，不下载正文、不转存图片；UA 写明用途，遇 403 / 429 立即停止，不绕过任何访问限制；不抓教师主页、公示名单等含个人信息的页面。内容版权归中山大学软件工程学院，两栏的栏目标题本身链到对应栏目页，每条深链回原文。

官网更新不频繁（发稿间隔常以周计），所以两栏显示的是「最新 3 条」并标日期，而不是严格的「当日」。

---

## 技术栈

- Three.js r160：GLTFLoader 载入吉祥物与头饰，OrbitControls 做轨道视角，字符环用 Canvas 贴图绕在圆环上
- GSAP 3.12.5 + CustomEase：面板呼出、入场、放大态位移
- 原生 CSS：CSS 变量做字号与配色 token，`cqw` 做自适应间距，无构建步骤
- 智谱 GLM-4-Flash：OpenAI 兼容格式，可直接换模型或换后端

改动后用浏览器刷新即可，不需要编译。3D 素材在 `models/`，替换同名 GLB 文件就生效。

---

## 已知限制

- 音乐播放器不内置音频，由用户导入本地文件
- 定制结果不持久化，刷新恢复默认
- 需要支持 WebGL2 的现代浏览器

---

## 版权

站点内容、吉祥物形象与衍生设计归作者所有，代码仅供学习参考，未经许可请勿商用或二次发布形象素材。

## 启用 GitHub Pages

仓库 Settings → Pages → Source 选 `Deploy from a branch`，分支 `main` / 目录 `/ (root)`，保存后访问
`https://hiklpa.github.io/STRCAT_Online/`。若走 Pages，AI 必须用 `worker/` 代理，否则没有后端可用。
