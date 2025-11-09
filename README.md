# X-Downloader

一个Node.js工具，用于定期监控指定的X（Twitter）用户的推文并自动下载内容（包括文字、照片、视频）。

## 功能特性

- 监控多个Twitter用户的新推文
- 自动下载推文的文字内容（JSON格式）
- 自动下载推文中的照片
- 自动下载推文中的视频，并可选择质量
- 定时检查更新
- 记录下载状态，避免重复下载

## 安装

1. 确保已安装Node.js（推荐v14+）

2. 克隆或下载本项目

3. 安装依赖：

```bash
npm install
```

## 配置

1. 复制环境变量示例文件并编辑：

```bash
cp .env.example .env
```

2. 编辑`.env`文件，填入必要信息：

```
# API配置
API_BASE_URL=https://api.tikhub.io
API_KEY=your_api_key_here  # 请填入您的TikHub API密钥
PROXY_URL=http://username:password@proxyhost:port  # HTTP/HTTPS代理地址（可选）

# 功能开关
MONITOR_ENABLED=true  # 是否启用监控功能（true/false，默认为true）
WEB_ENABLED=true  # 是否启用Web管理界面（true/false，默认为false）
WEB_PORT=3000  # Web界面端口（仅在WEB_ENABLED=true时生效）

# 监控设置
MONITOR_INTERVAL=60  # 监控间隔（分钟）
TARGET_USERS=elonmusk,twitter  # 要监控的用户（用逗号分隔）

# 下载设置
DOWNLOAD_DIR=./downloads  # 下载文件保存目录
DOWNLOAD_TEXT=true  # 是否下载文本内容
DOWNLOAD_PHOTOS=true  # 是否下载照片
DOWNLOAD_VIDEOS=true  # 是否下载视频
VIDEO_QUALITY=highest  # 视频质量（highest或lowest）
MAX_INITIAL_TWEETS=20  # 新用户加入时初始下载的推文数量
```

## 用户列表管理

我们提供了两种便捷的方式来管理您要监控的Twitter用户列表：

### 1. 直接编辑配置文件

用户列表保存在`users.json`文件中，您可以直接编辑该文件来添加或删除用户：

```json
{
  "users": ["elonmusk", "twitter", "username3"],
  "updatedAt": "2023-01-01T00:00:00.000Z"
}
```

服务会在每次检查时自动读取最新的用户列表，无需重启服务即可应用更改。

### 2. 使用命令行工具（推荐）

我们提供了一个命令行工具，让您可以通过简单的命令来管理用户列表：

```bash
# 安装依赖
npm install

# 添加用户
node cli.js add elonmusk

# 删除用户
node cli.js remove twitter

# 列出所有用户
node cli.js list

# 清空所有用户
node cli.js clear
```

## 使用

1. **安装依赖**：
   ```bash
   npm install
   ```

2. **配置环境变量**：
   编辑`.env`文件，填入您的API密钥和其他设置。
   - 配置`MAX_INITIAL_TWEETS`设置新用户初始下载的推文数量（可选，默认为20）
   - 配置`MONITOR_ENABLED`控制是否启用监控功能（默认为true）
   - 配置`WEB_ENABLED`控制是否启用Web管理界面（默认为false）

3. **添加要监控的用户**：
   ```bash
   node cli.js add username1 username2
   ```
   或者通过Web界面添加（如果启用了Web界面）

4. **启动服务**：
   ```bash
   npm start
   ```

### 功能模式

- **仅监控模式**：`MONITOR_ENABLED=true`，`WEB_ENABLED=false` - 只运行监控功能
- **仅Web界面模式**：`MONITOR_ENABLED=false`，`WEB_ENABLED=true` - 只运行Web界面，用于调试和管理
- **完整模式**：`MONITOR_ENABLED=true`，`WEB_ENABLED=true` - 同时运行监控和Web界面（推荐）

如果启用了监控功能，服务将按照设定的时间间隔自动检查并下载新的推文内容。每次检查时，服务会自动读取`users.json`文件中的最新用户列表。

## 新用户初始下载功能

当你添加一个从未被下载过的用户到监控列表时，系统会自动：

1. 检测该用户是新用户（没有下载历史记录）
2. 下载该用户的最新`MAX_INITIAL_TWEETS`条推文（由环境变量配置）
3. 自动处理分页，确保获取足够数量的推文
4. 保存该用户的下载状态，后续只会下载新发布的推文

这个功能让你可以快速获取新添加用户的历史内容，而不需要等待他们发布新推文。

## 下载内容与保存位置

### 下载的内容

1. **推文文本内容**：以JSON格式保存，包含推文ID、发布时间、文本内容、点赞数、转发数、回复数、引用数、浏览量和作者信息等完整数据。

2. **照片**：推文附带的所有照片，以原始格式（通常为JPG）保存。

3. **视频**：推文附带的所有视频，以MP4格式保存，可选择最高或最低质量。

### 保存位置

下载的内容将按照以下结构自动组织保存：

```
downloads/           # 主下载目录（可在.env中配置）
  └── [username]/    # 每个用户单独一个目录
      ├── text/      # 推文文本内容（JSON格式）
      ├── photos/    # 照片文件
      └── videos/    # 视频文件
```

文件名格式：
- 文本文件：`[tweet_id].json`
- 照片文件：`[tweet_id]_[media_id].[ext]`
- 视频文件：`[tweet_id]_[media_id].mp4`

## 状态记录与故障恢复

本项目使用SQLite数据库来记录所有推文的下载状态，提供更可靠的进度跟踪和故障恢复能力：

- **数据库位置**：`state/download_status.db`
- **记录内容**：
  - 每条推文的下载状态（pending、downloading、completed、failed）
  - 下载时间和错误信息
  - 用户的最新推文ID

- **自动故障恢复**：
  - 服务会自动检测并重试下载失败的推文
  - 即使程序中途崩溃，重启后也能从上次的进度继续
  - 不会重复下载已成功的内容，节省带宽和API调用

## 注意事项

1. 请确保您有使用TikHub API的合法权限
2. 下载内容可能受到Twitter用户隐私设置的限制
3. 请遵守相关法律法规，合理使用本工具
4. 服务将在停止时保留状态，下次启动时只会下载新的内容
5. 对于拥有大量推文的用户，初始下载可能需要一些时间，请耐心等待
6. SQLite数据库文件会随着下载内容增加而增大，定期备份state目录以防止数据丢失
7. 如果需要重置某个用户的下载记录，可以删除数据库中的相关记录
8. 使用代理时，请确保代理服务器支持HTTP/HTTPS连接，并且能够访问Twitter的媒体资源

## 许可证

MIT