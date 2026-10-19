# Atlassian Confluence OAuth Demo

一个前后端分离的 Atlassian Confluence OAuth 2.0 (3LO) + REST API v2 集成 demo。

## 功能

- OAuth Login 按钮：弹窗完成 Atlassian 授权。
- 登录成功后，在页面文本框中显示 Atlassian access token。
- Refresh 按钮：使用 refresh token 刷新 access token（自动保存轮换后的 refresh token）。
- Get Spaces 按钮：获取当前用户可见的 Confluence space 标题列表。
- 访问 `/logout`：清空后端内存会话、浏览器中的 JWT 和页面状态。

## 技术栈

- 前端：TypeScript + React 19 + Vite，Node.js 22.17.0。
- 后端：FastAPI + Python 3.14.6。
- 前后端鉴权：HS256 JWT（固定 demo 用户，无用户体系）。
- Atlassian token 仅保存在后端进程内存中，不使用数据库。

## 目录结构

```
apps/
├── backend/        FastAPI 服务
│   ├── app/
│   ├── env.example
│   └── requirements.txt
└── frontend/       React + Vite 前端
    ├── src/
    └── env.example
docs/
└── atlassian-oauth-demo-plan.md
```

> 说明：本环境的权限规则不允许直接创建 `.env.example`，因此示例文件命名为 `env.example`。使用时复制为 `.env`，真实的 `.env` 已被 git 忽略。

## 前置条件

- Node.js 22.17.0、npm 10.x
- Python 3.14.6
- 已存在的后端虚拟环境 `apps/backend/.venv`
- uv
- 一个 Atlassian OAuth 2.0 (3LO) 应用

## 1. 配置 Atlassian OAuth 应用

1. 打开 <https://developer.atlassian.com/console/myapps/>，创建一个 OAuth 2.0 (3LO) 应用。
2. 在 **Permissions** 中为 Confluence 添加细粒度 scope：`read:space:confluence`。
   - `offline_access` 由 Atlassian 自动允许，用于获取 refresh token。
   - 不要混用 classic scope（例如 `read:confluence-space.summary`）和细粒度 scope。
3. 在 **Authorization** 中登记 Callback URL，必须与后端 `ATLASSIAN_REDIRECT_URI` **逐字符一致**。
   - 本 demo 的回调落在前端页面：`http://localhost:5173/oauth2/callback`
   - 非 localhost 地址必须是 **HTTPS**。如果使用外部 IP，需要先准备 HTTPS 反向代理或隧道。
   - 外部部署示例：`https://your-host:5173/oauth2/callback`
   - 不要登记后端登录入口 `/api/auth/login`，它是发起授权的地址，不是回调地址。
4. 在 **Settings** 中获取 Client ID 和 Secret。

## 2. 启动后端

```bash
cd apps/backend
cp env.example .env
# 编辑 .env，至少填写：
#   ATLASSIAN_CLIENT_ID
#   ATLASSIAN_CLIENT_SECRET
#   ATLASSIAN_REDIRECT_URI
#   FRONTEND_URL
#   JWT_SECRET（建议 openssl rand -hex 32 生成）

uv pip install --python .venv/bin/python -r requirements.txt
.venv/bin/uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

健康检查：<http://localhost:8000/api/health>

### 后端环境变量

| 变量 | 说明 |
|---|---|
| `ATLASSIAN_CLIENT_ID` | Atlassian OAuth 应用 Client ID |
| `ATLASSIAN_CLIENT_SECRET` | Atlassian OAuth 应用 Secret |
| `ATLASSIAN_REDIRECT_URI` | 与 Atlassian 后台登记完全一致的前端回调地址；本地为 `http://localhost:5173/oauth2/callback`，非 localhost 必须 HTTPS |
| `ATLASSIAN_SCOPES` | 默认 `read:space:confluence offline_access` |
| `FRONTEND_URL` | 前端浏览器访问的完整 origin，用于 CORS 和登录失败时的跳转 |
| `JWT_SECRET` | JWT / OAuth state 签名密钥，生产环境必须使用长随机值 |
| `JWT_EXPIRE_MINUTES` | JWT 有效期，默认 480 分钟 |

## 3. 启动前端

```bash
cd apps/frontend
cp env.example .env
# 编辑 .env：
#   VITE_API_BASE_URL=https://your-host:8000
# 本地开发可使用 http://localhost:8000

npm install
npm run dev -- --host 0.0.0.0
```

打开显示在终端中的 Vite 地址（默认 <http://localhost:5173>）。

`VITE_API_BASE_URL` 是浏览器访问后端的公开地址，不要带结尾 `/`。

## 使用流程

1. 点击 **OAuth Login**，弹窗打开后端 `http://localhost:8000/api/auth/login`，再跳转到 Atlassian 授权页。
2. Atlassian 授权完成后回调前端页面：`http://localhost:5173/oauth2/callback?code=...&state=...`。
3. 前端回调页调用后端 `POST http://localhost:8000/api/auth/exchange`，由后端完成 code 换 token。
4. 回调页把 JWT 交给主窗口并自动关闭，页面显示 access token 和站点名称。
5. 点击 **Refresh** 获取新的 access token。
6. 点击 **Get Spaces**，下方文本框显示 space 标题列表。
7. 访问 `/logout` 或点击右上角 **Logout**，清空所有登录状态并回到初始页面。

## 关键实现说明

- OAuth 授权 URL：`https://auth.atlassian.com/authorize`，scope 为 `read:space:confluence offline_access`。
- 回调地址：Atlassian → 前端 `http://localhost:5173/oauth2/callback`。
- code 换 token：前端回调页把 `code` / `state` POST 到后端 `/api/auth/exchange`，后端再调用 `POST https://auth.atlassian.com/oauth/token`。`client_secret` 始终只保存在后端。
- 站点 `cloudId`：`GET https://api.atlassian.com/oauth/token/accessible-resources`，demo 取第一个站点。
- 列 space：`GET https://api.atlassian.com/ex/confluence/{cloudId}/wiki/api/v2/spaces?limit=250`。
- refresh token 会轮换，刷新后后端保存 Atlassian 返回的新 refresh token。
- access token 约 1 小时后过期；demo 不做自动刷新，由用户点击 **Refresh**。
- JWT 的 `sub` 固定为 `demo-user`；登出会清空内存 session，因此旧 JWT 也会立即失效。
- 前端回调页使用 `useRef` 防止 React StrictMode 重复兑换一次性 authorization code。

## 常见问题

| 现象 | 排查方向 |
|---|---|
| Vite 日志出现 `/api/auth/login` | 该请求应发到后端 `:8000`。检查 `VITE_API_BASE_URL=http://localhost:8000`，并重启 Vite（它只在启动时读取 `.env`） |
| `redirect_uri mismatch` | `ATLASSIAN_REDIRECT_URI` 必须与 Atlassian 后台登记值完全一致，本 demo 应为 `http://localhost:5173/oauth2/callback` |
| 回调页 404 或空白 | 确认前端路由是 `/oauth2/callback`，且 Vite 的 SPA fallback 正常工作 |
| `invalid_scope` / `Unauthorized; scope does not match` | 确认应用已启用 `read:space:confluence`，且没有混用 classic scope |
| 浏览器 CORS 错误 | `FRONTEND_URL` 必须与浏览器地址栏中的 origin 完全一致（含端口） |
| 回调页提示 exchange 失败 | 检查后端日志与 `ATLASSIAN_REDIRECT_URI`；authorization code 只能使用一次 |
| 点击 Get Spaces 提示 token 过期 | 点击 **Refresh**；refresh token 也失效时重新 OAuth 登录 |
| 重启后端后需要重新登录 | 会话存储在进程内存中，重启即丢失，这是 demo 的预期行为 |
| Vite 通过外部 IP 访问返回 403 | `vite.config.ts` 已设置 `server.allowedHosts: true`（仅 demo 使用） |

## 安全说明

按需求，Atlassian access token 会原样显示在网页文本框中，并且 JWT 存储在 `sessionStorage` 中。这两点都只适用于 demo，生产环境不应把 access token 暴露给浏览器。

OAuth 的 `client_secret` 始终只保存在后端。前端回调页只接收 `code` 和 `state`，然后通过后端交换 token，不会接触 client secret。

## 当前范围外

- Docker 打包与部署
- 自动化测试
- 多用户 / 多 Confluence 站点选择
- 后端持久化会话
- access token 自动刷新
- 远端 token 吊销与 space 分页
