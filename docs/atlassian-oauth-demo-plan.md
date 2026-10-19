# Confluence OAuth Demo：改为前端页面回调

## Context

当前实现让 Atlassian 直接回调后端 `http://localhost:8000/api/auth/callback`。用户决定改为：

- Atlassian 后台 Callback URL：`http://localhost:5173/oauth2/callback`
- Atlassian 授权完成后，浏览器弹窗直接落到前端 React 路由 `/oauth2/callback`
- 前端回调页拿到 `code` 和 `state` 后，调用后端交换 token
- `client_secret` 仍然只保存在后端，绝不能进入浏览器

这样做的原因：用户希望 OAuth 回调落在前端页面，而不是后端 API。但 authorization code 换 token 必须由后端完成，因此需要一个前端 → 后端的交换接口。

同时确认当前 access log 问题：`/api/auth/login` 是**后端**路由，正确地址是 `http://localhost:8000/api/auth/login`。如果 Vite 日志出现它，说明 `VITE_API_BASE_URL` 指向了 `:5173`、值为空，或修改 `.env` 后没有重启 Vite。

## 目标流程

1. 前端 Home 点击 **OAuth Login**，`window.open('http://localhost:8000/api/auth/login')`。
2. 后端 `/api/auth/login` 生成签名 state，302 到 `https://auth.atlassian.com/authorize`。
   - `redirect_uri` 使用 `ATLASSIAN_REDIRECT_URI=http://localhost:5173/oauth2/callback`。
3. Atlassian 授权完成后，弹窗重定向到：
   - 成功：`http://localhost:5173/oauth2/callback?code=...&state=...`
   - 失败：`http://localhost:5173/oauth2/callback?error=...&error_description=...`
4. 前端 `/oauth2/callback` 页面解析 query 参数，然后请求：
   - `POST http://localhost:8000/api/auth/exchange`
   - Body：`{"code": "...", "state": "..."}`
5. 后端校验 state、用 code 换 token、调用 accessible-resources 获取 `cloudId`、写入内存 session、签发 JWT，返回 `{"token": "<jwt>"}`。
6. 前端回调页通过 `window.opener.postMessage({type:'atlassian-oauth', token}, window.location.origin)` 把 JWT 交给主窗口，然后关闭弹窗。
7. 主窗口保存 JWT 到 `sessionStorage`，请求 `/api/atlassian/token` 展示 access token。
8. Refresh、Get Spaces、Logout 流程保持不变。

## 需要修改的文件

### 后端

**`apps/backend/app/routes/auth.py`**

- 保留 `GET /api/auth/login`。
- 删除原来的 `GET /api/auth/callback`，改为：

```python
class ExchangeRequest(BaseModel):
    code: str
    state: str

@router.post("/exchange")
async def exchange(payload: ExchangeRequest) -> dict[str, str]:
    verify_oauth_state(payload.state)
    tokens = await atlassian.exchange_code(payload.code)
    resources = await atlassian.get_accessible_resources(tokens["access_token"])
    # 空列表 -> HTTP 502，code=NO_CONFLUENCE_SITE
    # 写入 AtlassianSession
    return {"token": create_access_token()}
```

- `verify_oauth_state` 已经返回 `INVALID_STATE` 的 400 detail，直接让异常向上抛即可。
- Atlassian 交换失败时把 `AtlassianError` 转成 `HTTPException`，detail 为 `{"code": exc.code, "message": exc.message}`。
- `/api/auth/login` 在 client id/secret 缺失时，改为重定向到前端回调页：
  - `http://localhost:5173/oauth2/callback?error=...`（用 query string，不再用 hash）
- 新增 Pydantic 的 `ExchangeRequest` 导入。

`apps/backend/app/atlassian.py` 不需要改逻辑，因为 `exchange_code()` 一直使用 `settings.atlassian_redirect_uri`，只要配置改掉即可。

**`apps/backend/env.example`**

```env
ATLASSIAN_REDIRECT_URI=http://localhost:5173/oauth2/callback
FRONTEND_URL=http://localhost:5173
```

### 前端

**`apps/frontend/src/App.tsx`**

- 路由从 `/oauth/callback` 改为 `/oauth2/callback`。

**`apps/frontend/src/pages/OAuthCallback.tsx`**

- 从 `window.location.search` 读取 `code`、`state`、`error`、`error_description`（不再读 hash）。
- 用 `useRef` 做一次性执行保护，避免 React StrictMode 在开发环境重复调用交换接口（authorization code 只能使用一次）。
- 有 `window.opener` 时：
  - 有 `error`：`postMessage` 错误给主窗口并关闭。
  - 缺少 `code`/`state`：`postMessage` 错误并关闭。
  - 否则调用 `POST /api/auth/exchange`，成功后 `postMessage` token 并关闭；失败时 `postMessage` 错误信息并关闭。
- 没有 `window.opener`（用户直接访问回调页）时：
  - 成功则把 JWT 写入 `sessionStorage` 并 `window.location.replace('/')`。
  - 失败则展示错误文本。

**`apps/frontend/env.example`**

```env
VITE_API_BASE_URL=http://localhost:8000
```

**`apps/frontend/src/pages/Home.tsx`、`src/api.ts`**

- 无需改逻辑：Home 已监听 `atlassian-oauth` 消息并保存 token；`apiFetch` 可直接用于回调页的 POST 请求。
- 确认 `VITE_API_BASE_URL` 指向后端而不是前端。

## Atlassian 后台配置

在 OAuth 2.0 (3LO) 应用的 **Authorization → Callback URL** 中填写：

```
http://localhost:5173/oauth2/callback
```

注意：

- 必须与后端 `.env` 的 `ATLASSIAN_REDIRECT_URI` 完全一致。
- localhost 允许 HTTP；外部 IP 必须 HTTPS。
- 不要填 `http://localhost:5173/api/auth/login`。
- 登录入口仍然是后端 `http://localhost:8000/api/auth/login`。

## 本地配置核对

```env
# apps/backend/.env
ATLASSIAN_CLIENT_ID=...
ATLASSIAN_CLIENT_SECRET=...
ATLASSIAN_REDIRECT_URI=http://localhost:5173/oauth2/callback
ATLASSIAN_SCOPES=read:space:confluence offline_access
FRONTEND_URL=http://localhost:5173
JWT_SECRET=...

# apps/frontend/.env
VITE_API_BASE_URL=http://localhost:8000
```

修改后必须重启后端和 Vite；Vite 只在启动时读取 `.env`。

## 验证

1. **启动服务**
   - `cd apps/backend && .venv/bin/uvicorn app.main:app --reload --host 0.0.0.0 --port 8000`
   - `cd apps/frontend && npm run dev -- --host 0.0.0.0`
2. **检查请求归属**
   - OAuth Login 弹窗的第一个请求应出现在后端日志：`GET http://localhost:8000/api/auth/login`
   - 前端日志不应出现 `/api/auth/login`
   - Atlassian 回调后，弹窗应打开 `http://localhost:5173/oauth2/callback?code=...&state=...`
3. **完整授权流程**
   - 弹窗完成授权 → 前端回调页调用 `POST :8000/api/auth/exchange` → 弹窗关闭 → 主页面显示 access token 和站点名称。
4. **异常流程**
   - 用错误 state 调用 exchange，应返回 `400 {"code":"INVALID_STATE"}`。
   - 在 Atlassian 页面拒绝授权，前端回调页收到 `error` 并把错误显示在主页面。
5. **既有功能回归**
   - Refresh 后 access token 更新。
   - Get Spaces 返回 space 标题列表。
   - 访问 `/logout` 清空后端 session、`sessionStorage` 和页面状态。
6. **CORS**
   - 回调页从 `http://localhost:5173` 请求 `http://localhost:8000/api/auth/exchange`，预检应返回 `access-control-allow-origin: http://localhost:5173`。
7. **构建检查**
   - `npm run lint`、`npm run build` 通过。
   - 后端 TestClient 验证 exchange 的 state 校验和 JWT 返回。

## 文档同步

实现完成后更新：

- `README.md`：回调地址、流程、环境变量、常见问题。
- `docs/atlassian-oauth-demo-plan.md`：与本计划保持一致。

## 范围外

- 多用户、持久化会话、token 自动刷新。
- 一次性 state/nonce 的服务端存储（当前使用签名 state + 10 分钟有效期）。
- 生产环境反向代理与 HTTPS 部署。
- Docker 和自动化测试。
