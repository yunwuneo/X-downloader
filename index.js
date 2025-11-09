const dotenv = require('dotenv');
const fs = require('fs-extra');
const path = require('path');
const Monitor = require('./src/monitor');

// 加载环境变量
dotenv.config();

// 检测运行模式：serverless 或 local
const isServerless = process.env.SERVERLESS_MODE === 'true' || 
                     process.env.AWS_LAMBDA_FUNCTION_NAME !== undefined ||
                     process.env.VERCEL !== undefined ||
                     process.env.NETLIFY !== undefined ||
                     process.env.CF_PAGES !== undefined ||
                     (typeof globalThis !== 'undefined' && globalThis.env && globalThis.env.DB);

// 存储模式：serverless模式下使用S3，否则使用本地存储
const storageMode = isServerless ? 's3' : 'local';

// 数据库模式：只有在SERVERLESS_MODE=true时才使用D1，否则使用本地SQLite
const dbMode = process.env.SERVERLESS_MODE === 'true' ? 'd1' : 'sqlite';

// 创建下载目录（仅在本地模式下）
const downloadDir = process.env.DOWNLOAD_DIR || './downloads';
if (!isServerless) {
  fs.ensureDirSync(downloadDir);
}

// 解析目标用户（从环境变量，如果为空则使用空数组，后续会从users.json读取）
const targetUsers = (process.env.TARGET_USERS || '').split(',')
  .map(user => user.trim())
  .filter(user => user.length > 0);

// 创建状态记录目录
const stateDir = './state';
fs.ensureDirSync(stateDir);

// 初始化监控器
const monitor = new Monitor({
  apiKey: process.env.API_KEY,
  apiBaseUrl: process.env.API_BASE_URL || 'https://api.tikhub.io',
  proxyUrl: process.env.PROXY_URL || '',
  targetUsers, // 初始用户列表（可能为空，会从users.json读取）
  monitorInterval: parseInt(process.env.MONITOR_INTERVAL) || 60, // 分钟
  maxInitialTweets: parseInt(process.env.MAX_INITIAL_TWEETS) || 20, // 新用户初始下载推文数量
  downloadDir,
  downloadOptions: {
    downloadText: process.env.DOWNLOAD_TEXT === 'true',
    downloadPhotos: process.env.DOWNLOAD_PHOTOS === 'true',
    downloadVideos: process.env.DOWNLOAD_VIDEOS === 'true',
    videoQuality: process.env.VIDEO_QUALITY || 'highest'
  },
  stateDir,
  usersFile: './users.json', // 用户列表文件
  // Serverless模式配置（支持AWS S3及所有S3兼容API）
  storageMode: storageMode,
  s3Bucket: process.env.S3_BUCKET,
  s3Region: process.env.S3_REGION || process.env.AWS_REGION,
  s3BasePrefix: process.env.S3_BASE_PREFIX || 'downloads',
  s3Endpoint: process.env.S3_ENDPOINT, // S3兼容服务的endpoint（如Cloudflare R2）
  s3ForcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true', // 某些S3兼容服务需要
  s3AccessKeyId: process.env.S3_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID,
  s3SecretAccessKey: process.env.S3_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY,
  // 数据库配置（支持SQLite和Cloudflare D1）
  dbMode: dbMode,
  d1: typeof globalThis !== 'undefined' && globalThis.env ? globalThis.env.DB : null, // Cloudflare D1绑定
  d1Binding: process.env.D1_BINDING_NAME // D1绑定名称（如果使用自定义名称）
});

// 导出monitor对象，方便外部访问
module.exports = monitor;

// 启动监控器（如果启用）
const monitorEnabled = process.env.MONITOR_ENABLED !== 'false'; // 默认为 true，除非明确设置为 'false'
if (monitorEnabled) {
  // 获取实际加载的用户列表（从users.json读取后的）
  const actualUsers = monitor.getUsers();
  
  // 检查是否有用户需要监控
  if (actualUsers.length === 0) {
    console.warn('========================================');
    console.warn('警告: 当前没有要监控的用户');
    console.warn('请通过以下方式添加用户:');
    console.warn('1. 使用Web界面: http://localhost:' + (process.env.WEB_PORT || 3000));
    console.warn('2. 使用CLI工具: node cli.js add username');
    console.warn('3. 直接编辑 users.json 文件');
    console.warn('========================================');
  } else {
    // 启动监控器
    console.log(`开始监控用户: ${actualUsers.join(', ')}`);
    console.log(`监控间隔: ${process.env.MONITOR_INTERVAL || 60}分钟`);
    monitor.start();
  }
} else {
  console.log('========================================');
  console.log('监控功能已禁用 (MONITOR_ENABLED=false)');
  console.log('========================================');
}

// 启动Web管理界面（如果启用）
let webServer = null;
if (process.env.WEB_ENABLED === 'true') {
  const WebServer = require('./src/webServer');
  webServer = new WebServer({
    port: process.env.WEB_PORT || 3000,
    monitor: monitor
  });
  webServer.start();
}

// 优雅退出处理
process.on('SIGINT', () => {
  console.log('正在停止服务...');
  if (webServer) {
    webServer.stop();
  }
  if (monitorEnabled) {
    monitor.stop();
  }
  process.exit(0);
});

// 打印使用说明
console.log('========================================');
console.log('X-Downloader 服务已启动');
console.log('========================================');
console.log('运行模式: ' + (isServerless ? 'Serverless (S3存储)' : '本地模式 (文件系统)'));
if (monitorEnabled) {
  console.log('监控功能: 已启用');
} else {
  console.log('监控功能: 已禁用');
}
if (process.env.WEB_ENABLED === 'true') {
  console.log('Web界面: 已启用 (http://localhost:' + (process.env.WEB_PORT || 3000) + ')');
} else {
  console.log('Web界面: 已禁用');
}
if (isServerless) {
  console.log('S3存储配置:');
  console.log('  - Bucket: ' + (process.env.S3_BUCKET || '未设置'));
  console.log('  - Region: ' + (process.env.S3_REGION || process.env.AWS_REGION || '未设置'));
  console.log('  - Endpoint: ' + (process.env.S3_ENDPOINT || '使用默认AWS S3'));
  console.log('  - Base Prefix: ' + (process.env.S3_BASE_PREFIX || 'downloads'));
  if (process.env.S3_ENDPOINT) {
    console.log('  - 使用S3兼容服务: ' + process.env.S3_ENDPOINT);
  }
}
console.log('数据库配置:');
if (dbMode === 'd1') {
  console.log('  - 模式: Cloudflare D1 (Serverless)');
  if (process.env.D1_BINDING_NAME) {
    console.log('  - 绑定名称: ' + process.env.D1_BINDING_NAME);
  }
} else {
  console.log('  - 模式: SQLite (本地)');
  console.log('  - 数据库文件: state/download_status.db');
}
console.log('========================================');
if (monitorEnabled) {
  console.log('您可以通过修改 users.json 文件来更新要监控的用户列表');
  console.log('文件格式示例:');
  console.log('{');
  console.log('  "users": ["elonmusk", "twitter", "username3"],');
  console.log('  "updatedAt": "2023-01-01T00:00:00.000Z"');
  console.log('}');
  console.log('========================================');
}