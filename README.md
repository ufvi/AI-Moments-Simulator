# Moments-Simulator

一个在浏览器中模拟朋友圈的趣味项目。你可以创建多个虚拟账号（包括真人角色和 AI 角色），发布动态、互评、点赞，还能让 AI 自动为你生成评论、撰写帖子，甚至以不同人设替你“代写”心声。

支持多账号、AI 自动评论/发帖/代写、Markdown 图文视频动态、云端同步与多空间隔离。

🌐 **在线体验**：[https://moments-simulator.pages.dev](https://moments-simulator.pages.dev)

## ✨ 主要功能

- **多账号管理**：创建多个真人角色和 AI 人设，一键切换身份，每个角色拥有独立昵称、头像、徽章和活跃度。
- **丰富的动态内容**：支持 Markdown 语法（加粗、斜体、删除线、链接、图片、分割线、剧透等），图文、视频上传与压缩。
- **互动功能**：点赞、评论（支持换行）、评论折叠展开、动态置顶/搜索/编辑/删除。
- **AI 智能参与**：
  - **AI 评论**：选择一个 AI 身份，一键生成符合人设的评论；支持随机 AI 模式，按活跃度权重随机抽取 AI 账号进行评论。
  - **AI 发帖**：AI 自动生成情境内并写出朋友圈动态，可并发产生多条候选，挑选最满意的一条发布。
  - **AI 代写（Ghost Writer）**：由你提供经历，多个 AI 人设各自代写，最终以你的账号身份发出，并保留代笔信息。
- **数据持久化与同步**：
  - 本地基于 IndexedDB 和 localStorage，离线也能用。
  - 可选启用 **Firebase Realtime Database** 进行云端数据同步。
  - 图片/视频存储在 **Cloudflare R2**，通过 Pages Functions 代理访问。
- **多空间隔离**：通过 URL 参数 `?ns=你的空间名` 指定命名空间，不同空间数据完全隔离。
- **深色模式、搜索、导出/导入备份**（支持包含多媒体的 zip 包）。
- **移动端适配**，可安装为 PWA 使用。

## 🚀 立即体验

线上地址：**[https://moments-simulator.pages.dev/](https://moments-simulator.pages.dev/)**

在浏览器中打开即可使用，无需注册。想要多个独立的朋友圈，只需修改 `?ns=` 参数，例如：

```
https://moments-simulator.pages.dev/?ns=我的小圈子
https://moments-simulator.pages.dev/?ns=工作摸鱼群
```

不同 `ns` 之间的数据完全隔离，互不干扰。

## 🛠️ 自部署指南

### 1. 克隆仓库

```bash
git clone https://github.com/ufvi/Moments-Simulator.git
cd Moments-Simulator
```

### 2. 配置云同步（可选）

项目默认依赖 **Firebase Realtime Database** 进行云端数据同步，以及 **Cloudflare R2** 存储图片。如果你想拥有自己的独立后端，请按以下步骤配置：

#### 2.1 Firebase 配置

1. 前往 [Firebase 控制台](https://console.firebase.google.com/) 创建一个新项目（或使用已有项目）。
2. 在 **项目设置 → 常规 → 您的应用** 中添加一个 Web 应用，复制生成的 `firebaseConfig` 对象。
3. 打开项目中的 `firebase-config.js` 文件，将内容替换为你的配置，**不要将该文件提交到公开仓库**：

4. 在 Firebase 控制台启用 **Realtime Database**，并根据需要设置安全规则（测试阶段可使用公共读写规则：`{".read":true,".write":true}`）。

#### 2.2 Cloudflare R2 与 Pages Functions 配置

项目通过 Pages Functions 实现图片上传/下载 API，需要绑定两个资源：**KV** 和 **R2**。

1. 在 Cloudflare 后台创建 **KV namespace** 和 **R2 bucket**（名称随意，例如 `MOMENTS_KV` 和 `MOMENTS_R2`）。
2. 在 **Pages 项目设置 → Functions → 绑定** 中添加：
   - 类型 KV → 变量名 `MOMENTS_KV`
   - 类型 R2 → 变量名 `MOMENTS_R2`
3. 部署 Functions (`functions/api/[[path]].js`) 后，API 即自动生效。如果你没有使用 Cloudflare Pages，可以单独部署 Worker（`worker.js`），并将 `cloudflare.js` 中的 `WORKER_BASE_URL` 修改为你的 Worker 地址。

完成以上配置并部署后，你自己的云同步和图片存储就可以使用了。

### 3. 部署到 Cloudflare Pages

部署到 Cloudflare Pages，可以获得专属于你的链接，使用任意设备随时访问。

1. 将项目推送到 GitHub/GitLab 仓库。
2. 在 Cloudflare Pages 中创建新项目，关联仓库。
3. 构建设置保持默认，无需构建命令（纯静态 + Functions）。
4. 在项目设置中绑定上面提到的 KV 和 R2（变量名必须为 `MOMENTS_KV` 和 `MOMENTS_R2`）。
5. 部署完成后，你的朋友圈模拟器就上线了。

## 📦 技术栈

- 前端：原生 JavaScript + CSS + HTML，无框架依赖
- 数据存储：IndexedDB (本地) + Firebase Realtime Database (云端)
- 文件存储：Cloudflare R2
- 后端：Cloudflare Pages Functions / Worker
- AI API：兼容 OpenAI 接口格式（支持 DeepSeek、火山引擎等任何兼容模型）
- 其他：JSZip 用于备份打包，Intersection Observer 实现媒体懒加载

## 🤖 AI 使用说明

1. 在“设置 → AI API KEY 配置”中填入你的 API 地址、密钥和模型（支持所有 OpenAI 兼容接口，包括 DeepSeek、火山引擎等）。
2. 添加 AI 账号，可为其设置系统提示词、评论风格和活跃度。
3. 发帖或评论时，点击 🧠 生成按钮即可让 AI 以选中的人设参与讨论。
4. 开启“随机 AI 模式”后，每次生成评论都会按活跃度随机抽取一位 AI 人设，让你的朋友圈更热闹。
5. 使用“AI 发帖”：输入主题或让 AI 生成情境，可选择生成多条候选并挑选发布。
6. 使用“AI 代写”：描述你的经历，多位 AI 人设同时为你润色，选出最喜欢的表达以你的身份发出。

## 📝 本地开发

直接用任意静态文件服务器运行项目根目录即可：

```bash
npx serve .
```

或使用 Live Server 等工具。修改代码后刷新浏览器即可看到效果。注意，云同步功能需要部署到 Cloudflare Pages 或配置 Worker 后才能完全工作。

## 📄 许可

MIT License

---

如果你喜欢这个项目，欢迎给个 ⭐️ Star，也欢迎提交 PR 或 Issue 一起完善！

