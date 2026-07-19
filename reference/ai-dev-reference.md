# AI 功能参考

## API Key 存储

Key 存于 **localStorage**，键名 `moments_ai_config`（命名空间前缀 `{ns}_ai_config`）：

```js
// 存储结构
localStorage.getItem(window.App.KEY_ACC)        // 所有账号
localStorage.getItem(window.App.KEY_AI_CONFIG)   // AI 配置 JSON
```

`aiConfig` 对象：

```js
{
  endpoint: "https://api.openai.com/v1",    // API 地址，兼容 OpenAI / volcengine 格式
  model: "gpt-3.5-turbo",
  apiKey: "sk-...",                          // API Key（明文存储）
  timeout: 30,                               // 超时秒数
  temperature: 0.8                           // 生成温度（可选）
}
```

加载：`event.js` 中从 localStorage 读取 `KEY_AI_CONFIG`，解析为 `window.App.aiConfig`。

---

## AI 账号数据结构

存在 `window.App.accounts[]` 中，`isAI: true` 标记：

```js
{
  id: "acc_ai_1712345678901",
  nickname: "未命名AI",
  isAI: true,
  avatar: "",                               // base64 data:image/... 头像
  avatarText: "🤖",                         // emoji/文字头像
  avatarBg: "#6c5ce7",                     // 头像底色
  systemPrompt: "你是一个友善的朋友",        // AI 人设提示词
  style: "说话温柔",                        // 风格描述
  badgeText: "AI",
  badgeColor: "#888",
  activity: 1,                              // 活跃度权重 0-?，0=不参与随机
  createdAt: 1712345678000
}
```

---

## API 调用流程（ai.js）

```js
const base = window.App.aiConfig.endpoint.replace(/\/+$/, "");
const isVolcengine = /volces\.com/i.test(window.App.aiConfig.endpoint);
const url = base + (isVolcengine ? "/responses" : "/chat/completions");

const response = await fetch(url, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": "Bearer " + window.App.aiConfig.apiKey
  },
  body: JSON.stringify({
    model: window.App.aiConfig.model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage }
    ],
    temperature: window.App.aiConfig.temperature ?? 0.8,
    max_tokens: 2000
  }),
  signal: AbortSignal.timeout((window.App.aiConfig.timeout || 30) * 1000)
});
```

兼容火山引擎（volcengine）的 `/responses` 接口和标准 OpenAI `/chat/completions` 接口。

返回值提取：

```js
// OpenAI 格式
const text = data.choices[0].message.content;

// 火山引擎格式
const text = data.output
  .filter(o => o.type === "message")
  .flatMap(o => o.content.filter(c => c.type === "output_text"))
  .map(c => c.text)
  .join("");
```

---

## 功能模块

### 1. AI 评论（ai.js:13）

入口：`window.App.submitAIComment(postId)`
- 用当前 `activeAIId` 的账号身份发评论
- 读取 `commentInput-{postId}` 的值
- push 到 `post.comments[]`，`window.App.savePosts()`
- 手术式更新评论区（`window.App.updateCommentsSection`）

入口：`window.App.publishAIComment(postId, aiUserId, text)`
- 直接以指定 AI 账号身份插入评论

### 2. AI 发帖（ai.js:994）

入口：`window.App.publishAIPost(aiAcc, postText)`
- 创建新 post，`userId = aiAcc.id`
- `window.App.posts.unshift(newPost)`
- 手术式 prepend 卡片

### 3. AI 语录（ai.js:1377+）

- `window.App.generateAIQuote()` — 随机选 AI 账号，调用 API 生成一句语录
- 显示在右侧栏 `#quoteCard` 中
- 可收藏（保存在 localStorage `{ns}_saved_quotes`）

### 4. 随机 AI 模式

- `window.App.randomAIMode` — boolean
- 开启后，评论输入框旁的双击「AI 发送」从所有活跃（`activity > 0`）AI 账号中按权重随机选一个
- `renderAIDropdown()` 中显示 🎲 开关

### 5. 代写（Ghost Writer）（ai.js:1028）

- `window.App.openGhostWriterModal()` — 打开代写弹窗
- 用户输入自己的经历/感受，选择要代写的 AI 人设
- `window.App.generateGhostPost(realUser, aiAccounts, ghostInput)` — 调用 API 并行生成多个版本
- 用户选择版本后：
  - `publishGhostPost(realUser, aiAcc, text, ghostInput)` — 直接以用户身份发出（带 `ghostWriter` / `ghostInput` 标记）
  - `prefillGhostBox(realUser, aiAcc, text, ghostInput)` — 填入发布框让用户进一步修改

### 6. 账号管理（modal.js:259）

- `window.App.addAIAccount()` — 创建新 AI 账号，自动打开编辑面板
- `window.App.editAccount(accId)` — 编辑账号弹窗（昵称、头像、systemPrompt、style、activity、badge）
- `window.App.addAccount()` — 创建普通账号
- `window.App.confirmDeleteAccount(accId)` — 删除账号确认

---

## 关键 UI 文件

| 文件 | 职责 |
|------|------|
| `ai.js` | AI API 调用、评论/发帖/语录/代写逻辑、彩蛋语录数组、showGhostInfo |
| `modal.js` | 账号增删改弹窗、badge HTML 生成 |
| `render.js` | AI 账号列表渲染（`renderSidebarAIList`、`renderAIDropdown`）、AI 评论样式 |
| `state.js` | 账号数据管理（`saveAccounts`、`loadAccounts`） |
| `event.js` | AI 配置加载、UI 事件绑定、发帖/评论按钮路由 |
