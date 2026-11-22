# STRCAT AI 代理

一个 Cloudflare Worker，把吉祥物的对话请求转发给智谱。**API Key 存在 Cloudflare 侧，不进前端**，
所以这个站可以公开发布而不泄露密钥。

## 为什么要这一层

浏览器直接调智谱必须把 `sk-...` 写进 JS —— 任何人按 F12 都能看到，拿去盗刷你的额度。
Key 只能放服务端。这一层就是那个服务端。

## 部署（4 条命令）

在 `worker/` 目录里依次跑：

```bash
npm i -g wrangler                 # 装 CLI，只需一次
wrangler login                    # 浏览器里授权 Cloudflare 账号，只需一次
wrangler secret put ZHIPU_KEY     # 粘贴智谱 API Key（sk- 开头）
wrangler deploy                   # 部署，会打印一个 *.workers.dev 地址
```

第 4 步打印出来的地址形如 `https://strcat-ai-proxy.xxx.workers.dev`，
把它填回 `index.html` 的 `AI_ENDPOINT`，**结尾补上 `/chat`**：

```js
const AI_ENDPOINT = 'https://strcat-ai-proxy.xxx.workers.dev/chat';
```

## 拿到智谱 Key

1. 打开 https://open.bigmodel.cn/ ，手机号注册 + 实名认证
2. 左侧「API 密钥管理」→ 创建密钥 → 复制 `sk-` 开头那串（关掉页面就再也看不到）
3. `glm-4-flash` 是**永久免费**的（无限 Token、30 并发），正常个人站点用不完

## 部署后必做：收紧跨域

第一次部署完成后，编辑 `src/index.js` 里的 `ALLOW_ORIGINS`，
把你的站点域名加进去，再 `wrangler deploy` 一次：

```js
const ALLOW_ORIGINS = [
  'http://localhost:8000',                 // 本地调试
  'https://你的站点.workers.dev',           // 你的线上域名
];
```

**别改成 `'*'`** —— 那等于把代理开放给任何人，别人可以在自己的网站上调用它、烧你的额度。
线上域名 + `localhost` 各留一条就够了。

## 路由

Worker 只认 `POST /chat`，其余路径一律 404。

## 内置的防滥用

这是个公开接口，所以挡了几层（改的时候别把它们删掉）：

| 措施 | 值 | 挡什么 |
|---|---|---|
| 跨域白名单 | `ALLOW_ORIGINS` | 别的网站拿不到响应 |
| 请求体上限 | 32 KB | 灌超长内容刷额度 |
| 消息条数上限 | 12 条 | 同上 |
| 正文合计上限 | 4000 字 | 同上 |
| 工具白名单 | 只放行 `get_weather` / `get_time` | 提示注入骗模型去调别的函数 |
| `max_tokens` | 512 | 单次回复封顶 |

## 换模型

`worker/wrangler.toml` 里取消注释即可，不用改代码：

```toml
[vars]
MODEL = "glm-4.5-flash"
```

## 本地调试 Worker

```bash
wrangler dev          # 起一个本地代理，默认 http://127.0.0.1:8787
```

然后把 `index.html` 的 `AI_ENDPOINT` 指到 `http://127.0.0.1:8787/chat` 就能联调。
`wrangler dev` 需要 `ZHIPU_KEY` —— 用一个 `worker/.dev.vars` 文件（已在 `.gitignore` 里）：

```
ZHIPU_KEY=sk-你的测试key
```

## 自测

`.workbuddy/tools/worker-check.mjs` 把上游换成假的，验 CORS、各项校验、工具白名单和转发：

```bash
node .workbuddy/tools/worker-check.mjs
```

不需要网络、不需要真 key。
