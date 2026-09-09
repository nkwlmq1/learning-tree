# Learning Tree 网页编辑功能交接记录

更新时间：2026-09-09

## 当前交付源

- GitHub：`nkwlmq1/learning-tree`
- 分支：`main`
- 当前 GitHub HEAD：`334c36b933a42b72db004c019848bd28190510a8`
- Cloudflare Worker：`digitalgarden`
- 网站：`https://digitalgarden.ai-control-center-k90010615.workers.dev`
- 最近一次手动部署版本：`310f6c14-a507-42e1-b269-7763d9a318d1`
- 本地目录 `D:\learning sites` 不是交付源；`remote-main-readonly-20260909` 是本次按 GitHub main 建立的临时工作副本。

## 已完成

- 在导航页标题和各笔记标题旁增加“编辑”入口。
- 实现网页内编辑器：标题、Markdown 正文、分类、主目录、笔记路径。
- 支持新建笔记、修改路径、修改分类和保存说明。
- Worker 通过 GitHub API 读取和更新 Markdown 文件，更新 GitHub `main` 后由 Cloudflare 重新部署。
- 实现 GitHub OAuth：state/nonce、加密 HttpOnly 会话、登录/退出、GitHub 文件读写。
- 保留旧 `SITE_PASSWORD` 代码；公开阅读路径未被 SITE_PASSWORD 阻塞。
- 保留旧 `/__oauth/*`、`/__api/*`、`/__editor` 路由，并增加浏览器兼容别名 `/login`、`/api/*`、`/editor`。
- GitHub OAuth 应用已配置多个兼容回调地址；当前 Worker secret 已配置，源码不包含任何 Secret。

## 关键修改文件

- `src/worker.js`
- `src/site/_includes/layouts/index.njk`
- `src/site/_includes/layouts/note.njk`
- `src/site/scripts/digital-garden-editor.js`
- `src/site/scripts/digital-garden-inline-editor.js`
- `src/site/notes/00-Learning-Tree.md`

## 已验证

- `npm test`：16 个测试文件、387 个测试全部通过。
- Worker 和编辑器 JavaScript 语法检查通过。
- `/`：200。
- `/editor`：正常跳转到 `editor.html`。
- `/__editor`：兼容跳转正常。
- `/api/session` 与 `/__api/session`：未登录时返回 200。
- `/login`：正常跳转到 GitHub OAuth。
- 首页编辑按钮和笔记编辑按钮已在真实部署中出现。

## 当前未完成的验收

Chrome 当前控制会话在 GitHub 授权完成后，拦截带 OAuth `code/state` 查询参数的回跳，并显示 `ERR_BLOCKED_BY_CLIENT`。普通首页、编辑器和普通查询参数可以打开；Worker 端点本身可通过外部请求正常响应。

因此以下链路尚未取得真实通过证据：

`GitHub 授权 -> 浏览器回跳 -> 建立会话 -> 读取 Markdown -> 保存 GitHub -> Cloudflare 重建 -> 页面刷新`

不能把当前状态报告为 PASS。下一步应使用不会拦截 OAuth 授权码回跳的普通 Chrome 会话或查明控制扩展的 OAuth 回跳规则，然后从 `/login` 重新测试。

## 节点同步说明

本次用户后来提出“把现有节点同步到 GitHub 仓库为唯一真实源”，但该动作在中途被澄清为“只需要项目交接记录”，因此没有执行节点合并或覆盖。

当前 GitHub main 已有 18 个 canonical Markdown 节点；本地根目录 `src/site/notes` 另有 4 个旧节点。它们存在内容重叠，若以后确实要同步，应先逐节点合并本地独有内容，不能用旧本地文件直接覆盖 GitHub 较新的节点。

## 安全边界

- 不要在聊天、日志、源码或交接文档中写入 OAuth Secret、Session Secret 或 PAT。
- 之前用于推送的临时 GitHub PAT 已撤销。
- 不使用 localStorage 作为正式保存。
- 不使用 Cloudflare Access 或数据库替代 GitHub OAuth/Markdown 源。
