# Clerk 认证配置指南

本文档说明如何在 Clerk 上配置认证，以便为 X-Downloader Web UI 添加密码保护。

## 在 Clerk 上需要完成的配置

### 1. 创建 Clerk 账户和应用

1. 访问 [Clerk 官网](https://clerk.dev/) 并注册账户
2. 登录后，创建一个新的应用程序（Application）
3. 选择适合的认证方式（推荐使用 Email/Password 或 Social OAuth）

### 2. 获取必要的密钥

在 Clerk Dashboard 中，您需要获取以下信息：

1. **Secret Key (CLERK_SECRET_KEY)**
   - 位置：Dashboard → API Keys → Secret Keys
   - 点击 "Show" 或 "Reveal" 按钮查看
   - 格式：`sk_test_...` 或 `sk_live_...`
   - **重要**：这是后端验证 token 的密钥，请妥善保管

2. **Publishable Key (CLERK_PUBLISHABLE_KEY)**
   - 位置：Dashboard → API Keys → Publishable Keys
   - 格式：`pk_test_...` 或 `pk_live_...`
   - 用于前端 SDK 初始化

3. **Frontend API URL (CLERK_FRONTEND_API)**
   - 位置：Dashboard → Settings → Domains
   - 通常格式：`your-app.clerk.accounts.dev` 或 `accounts.clerk.dev`
   - 这是 Clerk 前端 API 的域名

### 3. 配置允许的域名（重要）

1. 在 Clerk Dashboard 中，进入 **Settings** → **Domains**
2. 添加您的应用域名（如果部署在公网上）
   - 例如：`yourdomain.com`
   - 或者：`localhost:3000`（用于本地开发）
3. 确保 **Allowed Origins** 包含您的应用 URL

### 4. 配置认证方式

1. 进入 **User & Authentication** → **Email, Phone, Username**
2. 选择您希望使用的认证方式：
   - **Email/Password**：推荐用于管理界面
   - **Social OAuth**：可选（Google, GitHub 等）
3. 配置密码要求（最小长度、复杂度等）

### 5. 配置会话设置（可选）

1. 进入 **Sessions**
2. 配置会话过期时间
3. 配置是否允许多设备登录

## 环境变量配置

在您的 `.env` 文件中添加以下环境变量：

```env
# Clerk 认证配置
CLERK_SECRET_KEY=sk_test_xxxxxxxxxxxxxxxxxxxxx
CLERK_PUBLISHABLE_KEY=pk_test_xxxxxxxxxxxxxxxxxxxxx
CLERK_FRONTEND_API=your-app.clerk.accounts.dev
```

### 环境变量说明

- **CLERK_SECRET_KEY**（必需）：Clerk Secret Key，用于后端验证用户 token
- **CLERK_PUBLISHABLE_KEY**（必需）：Clerk Publishable Key，用于前端 SDK 初始化
- **CLERK_FRONTEND_API**（必需）：Clerk Frontend API 域名，用于加载前端 SDK

## 安装依赖

运行以下命令安装 Clerk SDK：

```bash
npm install
```

## 功能说明

配置完成后，Web UI 将具备以下功能：

1. **登录保护**：所有页面和 API 都需要登录才能访问
2. **自动重定向**：未登录用户访问页面时，会自动显示登录界面
3. **会话管理**：登录状态会通过 Cookie 和 Token 保持
4. **API 认证**：所有 API 请求都需要包含有效的认证 token

## 测试

1. 启动应用：`npm start`
2. 访问 Web UI：`http://localhost:3000`
3. 应该看到 Clerk 登录界面
4. 使用在 Clerk 中创建的用户账户登录
5. 登录成功后，应该能够正常访问管理界面

## 故障排除

### 问题：登录页面显示 "Clerk 未正确配置"

**解决方案**：
- 检查 `.env` 文件中的环境变量是否正确设置
- 确保环境变量名称拼写正确
- 重启应用以使环境变量生效

### 问题：登录后仍然无法访问

**解决方案**：
- 检查浏览器控制台是否有错误
- 确认 `CLERK_FRONTEND_API` 配置正确
- 检查 Clerk Dashboard 中的域名配置

### 问题：Token 验证失败

**解决方案**：
- 确认 `CLERK_SECRET_KEY` 是正确的 Secret Key（不是 Publishable Key）
- 检查服务器日志中的错误信息
- 确认环境变量已正确加载

## 安全建议

1. **生产环境**：使用 `sk_live_...` 和 `pk_live_...`（Live 密钥）
2. **开发环境**：可以使用 `sk_test_...` 和 `pk_test_...`（Test 密钥）
3. **密钥保护**：永远不要将 Secret Key 提交到代码仓库
4. **HTTPS**：在生产环境中使用 HTTPS 以保护认证信息

## 禁用认证（开发用途）

如果暂时不想使用认证功能，只需不设置 `CLERK_SECRET_KEY` 环境变量即可。系统会检测到未配置 Clerk，并允许所有请求通过（不要求认证）。

**注意**：在生产环境中，强烈建议启用认证功能以保护您的应用。

