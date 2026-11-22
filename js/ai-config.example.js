/* 复制成 js/ai-config.js 再填值（那份不进 git）。
   不放密钥时 AI 聊天会提示「还没配好接口」，页面其余部分不受影响。 */

/* 方案一 · 本地直连（key 会进前端，只适合自己看）
   拿 Key：https://open.bigmodel.cn/ → 注册实名 → 「API 密钥管理」→ 创建 */
window.STRCAT_AI_CONFIG = {
  apiKey: 'YOUR_ZHIPU_API_KEY',
  endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
  model: 'glm-4-flash',
};

/* 方案二 · 经 Cloudflare Worker 代理（公网发布用，key 只在服务端）
   部署见 worker/README.md，地址结尾要补 /chat
window.STRCAT_AI_CONFIG = {
  apiKey: '',
  endpoint: 'https://strcat-ai-proxy.xxx.workers.dev/chat',
  model: 'glm-4-flash',
};
*/
