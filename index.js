const dotenv = require('dotenv');
const fs = require('fs-extra');
const path = require('path');
const Monitor = require('./src/monitor');

// 加载环境变量
dotenv.config();

// 创建下载目录
const downloadDir = process.env.DOWNLOAD_DIR || './downloads';
fs.ensureDirSync(downloadDir);

// 解析目标用户
const targetUsers = (process.env.TARGET_USERS || '').split(',')
  .map(user => user.trim())
  .filter(user => user.length > 0);

if (targetUsers.length === 0) {
  console.error('请在.env文件中配置要监控的用户');
  process.exit(1);
}

// 创建状态记录目录
const stateDir = './state';
fs.ensureDirSync(stateDir);

// 初始化监控器
const monitor = new Monitor({
  apiKey: process.env.API_KEY,
  apiBaseUrl: process.env.API_BASE_URL || 'https://api.tikhub.io',
  proxyUrl: process.env.PROXY_URL || '',
  targetUsers,
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
  usersFile: './users.json' // 用户列表文件
});

// 导出monitor对象，方便外部访问
module.exports = monitor;

// 启动监控器
console.log(`开始监控用户: ${targetUsers.join(', ')}`);
console.log(`监控间隔: ${process.env.MONITOR_INTERVAL}分钟`);
monitor.start();

// 优雅退出处理
process.on('SIGINT', () => {
  console.log('正在停止监控服务...');
  monitor.stop();
  process.exit(0);
});

// 打印使用说明
console.log('========================================');
console.log('X-Downloader 服务已启动');
console.log('========================================');
console.log('您可以通过修改 users.json 文件来更新要监控的用户列表');
console.log('文件格式示例:');
console.log('{');
console.log('  "users": ["elonmusk", "twitter", "username3"],');
console.log('  "updatedAt": "2023-01-01T00:00:00.000Z"');
console.log('}');
console.log('========================================');