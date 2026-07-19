# Markdown 换行模式

`markdown.js` 顶部 `legacyNewline` 控制换行行为：

```js
var legacyNewline = false;   // 默认
```

## 两种模式

### `legacyNewline: true`

单 `\n` 就切段落，连续空行中多的 `\n` 产生 `<br>`。

```
第1行
第2行

新段落
```
→ `<p>第1行</p>\n<p>第2行</p>\n<br>\n<p>新段落</p>`

### `legacyNewline: false`

单 `\n` 留在同一段，空行 `\n\n` 才分段（CommonMark 标准）。

```
第1行
第2行

新段落
```
→ `<p>第1行<br>\n第2行</p>\n<p>新段落</p>`

---

## 设置方式

### 全局默认

改 `markdown.js` 顶部变量：

```js
var legacyNewline = true;   // 单 \n 切段落
// var legacyNewline = false; // 单 \n 不切段
```

### 按次覆盖

```js
App.parseMarkdown(text)                  // 用全局默认
App.parseMarkdown(text, false, true)     // 本次：单 \n 切段落
App.parseMarkdown(text, false, false)    // 本次：单 \n 不切段
App.parseMarkdown(text, true)            // 行内模式
App.parseMarkdownAI(text)               // AI 解析
App.parseMarkdownAI(text, true)          // AI 解析，单 \n 切段落
```

---

## 实现原理

两种行为共用同一个 `marked.umd.js`，通过 `window.__nl` 标志切换：

| `window.__nl` | 段落合并 | `space` 渲染器 |
|:---:|---|
| `1` | 连续行合并为一段 | 返回 `""` |
| 不设置 | 单行独立成段 | 多余 `\n` 输出 `<br>` |

`parseMarkdown` / `parseMarkdownAI` 在调用前设置 `window.__nl`，调用后在 `finally` 中清理。
