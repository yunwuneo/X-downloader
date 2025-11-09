const cron = require('node-cron');
const TwitterApi = require('./twitterApi');
const Downloader = require('./downloader');
const fs = require('fs-extra');
const path = require('path');
const DatabaseManager = require('./databaseManager');

class Monitor {
  constructor(options) {
    this.api = new TwitterApi({
      apiKey: options.apiKey,
      apiBaseUrl: options.apiBaseUrl,
      proxyUrl: options.proxyUrl || null
    });
    
    this.downloader = new Downloader({
      downloadDir: options.downloadDir,
      downloadOptions: options.downloadOptions,
      proxyUrl: options.proxyUrl || null,
      // 存储模式配置
      storageMode: options.storageMode || 'local',
      s3Bucket: options.s3Bucket,
      s3Region: options.s3Region,
      s3BasePrefix: options.s3BasePrefix,
      s3Endpoint: options.s3Endpoint,
      s3ForcePathStyle: options.s3ForcePathStyle,
      s3AccessKeyId: options.s3AccessKeyId,
      s3SecretAccessKey: options.s3SecretAccessKey
    });
    
    this.targetUsers = options.targetUsers;
    this.monitorInterval = options.monitorInterval; // 分钟
    this.maxInitialTweets = options.maxInitialTweets || 20; // 新用户初始下载推文数量
    this.stateDir = options.stateDir;
    this.usersFile = options.usersFile || './users.json'; // 用户列表文件路径
    this.cronJob = null;
    
    // 确保state目录存在（仅在本地模式下）
    if (options.dbMode !== 'd1') {
      fs.ensureDirSync(this.stateDir);
    }
    
    // 初始化数据库管理器
    // 在serverless模式下，dbPath不会被使用，但为了兼容性仍然传递
    const dbPath = options.dbMode === 'd1' ? null : path.join(this.stateDir, 'download_status.db');
    this.db = new DatabaseManager(dbPath, {
      dbMode: options.dbMode || 'sqlite', // 'sqlite' 或 'd1'
      d1: options.d1,
      d1Binding: options.d1Binding
    });
    
    // 初始化用户列表文件
    this.initializeUsersFile();
    
    // 初始化数据库
    this.initDatabase();
  }
  
  // 初始化数据库
  async initDatabase() {
    try {
      await this.db.init();
      console.log('数据库初始化成功');
    } catch (error) {
      console.error('数据库初始化失败:', error.message);
    }
  }
  
  // 初始化用户列表文件
  initializeUsersFile() {
    try {
      if (!fs.existsSync(this.usersFile)) {
        // 如果文件不存在，创建并写入初始用户列表
        if (this.targetUsers && this.targetUsers.length > 0) {
          fs.writeJsonSync(this.usersFile, {
            users: this.targetUsers,
            updatedAt: new Date().toISOString()
          }, { spaces: 2 });
          console.log(`已创建用户列表文件: ${this.usersFile}`);
        } else {
          // 如果初始用户列表为空，创建空文件
          fs.writeJsonSync(this.usersFile, {
            users: [],
            updatedAt: new Date().toISOString()
          }, { spaces: 2 });
          console.log(`已创建空的用户列表文件: ${this.usersFile}`);
          console.warn('警告: 用户列表为空，请通过Web界面或CLI工具添加用户');
        }
      } else {
        // 如果文件存在，从文件读取用户列表（优先使用文件中的用户列表）
        const userData = fs.readJsonSync(this.usersFile);
        if (userData.users && Array.isArray(userData.users)) {
          if (userData.users.length > 0) {
            this.targetUsers = userData.users;
            console.log(`已从文件加载用户列表 (${userData.users.length}个用户): ${this.targetUsers.join(', ')}`);
          } else {
            // 文件存在但用户列表为空
            this.targetUsers = [];
            console.log('用户列表文件存在但为空');
            console.warn('警告: 用户列表为空，请通过Web界面或CLI工具添加用户');
          }
        } else {
          console.warn('用户列表文件格式不正确，使用配置中的用户列表');
        }
      }
      
      // 最终检查：如果用户列表仍然为空，给出警告
      if (!this.targetUsers || this.targetUsers.length === 0) {
        console.warn('警告: 当前没有要监控的用户，请通过Web界面或CLI工具添加用户');
      }
    } catch (error) {
      console.error(`初始化用户列表文件时出错:`, error.message);
      if (this.targetUsers && this.targetUsers.length > 0) {
        console.log(`使用配置中的用户列表: ${this.targetUsers.join(', ')}`);
      } else {
        console.warn('警告: 无法读取用户列表文件，且配置中也没有用户');
      }
    }
  }
  
  // 获取当前用户列表
  getUsers() {
    return this.targetUsers;
  }
  
  // 更新用户列表
  updateUsers(newUsers) {
    try {
      this.targetUsers = newUsers;
      fs.writeJsonSync(this.usersFile, {
        users: newUsers,
        updatedAt: new Date().toISOString()
      }, { spaces: 2 });
      console.log(`已更新用户列表: ${newUsers.join(', ')}`);
      return true;
    } catch (error) {
      console.error(`更新用户列表时出错:`, error.message);
      return false;
    }
  }
  
  // 开始监控
  start() {
    // 立即执行一次
    this.checkAllUsers();
    
    // 设置定时任务
    const cronExpression = `*/${this.monitorInterval} * * * *`; // 每N分钟执行一次
    this.cronJob = cron.schedule(cronExpression, () => {
      this.checkAllUsers();
    });
    
    console.log(`监控服务已启动，将每${this.monitorInterval}分钟检查一次`);
  }
  
  // 停止监控
  stop() {
    if (this.cronJob) {
      this.cronJob.stop();
    }
    console.log('监控服务已停止');
  }
  
  // 检查所有用户的新推文
  async checkAllUsers() {
    console.log(`开始检查用户更新 - ${new Date().toISOString()}`);
    
    // 再次从文件读取用户列表，以便实时更新
    try {
      if (fs.existsSync(this.usersFile)) {
        const userData = fs.readJsonSync(this.usersFile);
        if (userData.users && Array.isArray(userData.users) && userData.users.length > 0) {
          this.targetUsers = userData.users;
        }
      }
    } catch (error) {
      console.error(`读取用户列表文件时出错:`, error.message);
    }
    
    for (const username of this.targetUsers) {
      try {
        await this.checkUser(username);
      } catch (error) {
        console.error(`检查用户 ${username} 时出错:`, error.message);
      }
    }
  }
  
  // 检查单个用户的新推文
  async checkUser(username) {
    console.log(`检查用户: ${username}`);
    
    // 获取用户最新状态
    const lastTweetId = await this.getLastTweetId(username);
    
    let tweets = [];
    let isNewUser = !lastTweetId;
    
    if (isNewUser) {
      // 新用户，需要下载前N条推文
      console.log(`发现新用户: ${username}，正在下载前 ${this.maxInitialTweets} 条推文...`);
      tweets = await this.fetchInitialTweets(username);
    } else {
      // 老用户，只需要下载新推文
      const response = await this.api.fetchUserMedia(username);
      if (!response.data || !response.data.timeline) {
        console.log(`未获取到用户 ${username} 的数据`);
        return;
      }
      tweets = response.data.timeline;
    }
    
    let newTweetsCount = 0;
    let processedTweets = 0;
    let downloadedCount = 0;
    let failedCount = 0;
    
    // 处理每条推文
    for (const tweet of tweets) {
      // 如果是老用户，且推文ID小于等于上次的，说明是旧推文
      if (!isNewUser && tweet.tweet_id <= lastTweetId) {
        continue;
      }
      
      // 如果是新用户，且已经处理了足够数量的推文，就停止
      if (isNewUser && processedTweets >= this.maxInitialTweets) {
        break;
      }
      
      processedTweets++;
      
      // 检查推文是否已经下载完成
      const isDownloaded = await this.isTweetDownloaded(username, tweet.tweet_id);
      if (isDownloaded) {
        console.log(`推文已存在: ${tweet.tweet_id}`);
        continue;
      }
      
      newTweetsCount++;
      console.log(`发现新推文: ${tweet.tweet_id} - ${tweet.text.substring(0, 50)}...`);
      
      // 标记为正在下载
      await this.updateTweetStatus(username, tweet.tweet_id, 'downloading');
      
      try {
        // 下载推文内容
        await this.downloader.downloadTweet(tweet, username);
        await this.updateTweetStatus(username, tweet.tweet_id, 'completed');
        downloadedCount++;
        
        // 更新最新推文ID（只更新为第一条推文的ID，因为推文是按时间倒序排列的）
        if (processedTweets === 1) {
          await this.saveLastTweetId(username, tweet.tweet_id);
        }
      } catch (error) {
        console.error(`下载推文失败: ${tweet.tweet_id}`, error.message);
        await this.updateTweetStatus(username, tweet.tweet_id, 'failed', error.message);
        failedCount++;
      }
      
      // 避免请求过快
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    console.log(`用户 ${username} 检查完成:`);
    console.log(`- 处理推文数: ${processedTweets}`);
    console.log(`- 新增推文数: ${newTweetsCount}`);
    console.log(`- 成功下载: ${downloadedCount}`);
    console.log(`- 下载失败: ${failedCount}`);
    
    // 尝试重试失败的推文
    if (failedCount > 0) {
      console.log(`正在尝试重试失败的推文...`);
      await this.retryFailedTweets(username);
    }
  }
  
  // 获取新用户的初始推文（支持分页）
  async fetchInitialTweets(username) {
    let allTweets = [];
    let cursor = '';
    let hasMore = true;
    
    try {
      while (hasMore && allTweets.length < this.maxInitialTweets) {
        const response = await this.api.fetchUserMedia(username, cursor);
        
        if (!response.data || !response.data.timeline) {
          console.log(`未获取到用户 ${username} 的数据`);
          break;
        }
        
        // 添加到所有推文列表
        allTweets = [...allTweets, ...response.data.timeline];
        
        // 检查是否有下一页且还需要更多推文
        if (response.data.next_cursor && allTweets.length < this.maxInitialTweets) {
          cursor = response.data.next_cursor;
          // 避免请求过快
          await new Promise(resolve => setTimeout(resolve, 1000));
        } else {
          hasMore = false;
        }
      }
      
      // 限制返回的推文数量
      return allTweets.slice(0, this.maxInitialTweets);
    } catch (error) {
      console.error(`获取用户 ${username} 初始推文时出错:`, error.message);
      return [];
    }
  }
  
  // 获取用户上次检查的推文ID
  async getLastTweetId(username) {
    try {
      return await this.db.getLastTweetId(username);
    } catch (error) {
      console.error(`获取用户 ${username} 最后推文ID时出错:`, error.message);
      return null;
    }
  }
  
  // 保存用户最新推文ID
  async saveLastTweetId(username, tweetId) {
    try {
      await this.db.saveLastTweetId(username, tweetId);
    } catch (error) {
      console.error(`保存用户 ${username} 最后推文ID时出错:`, error.message);
    }
  }
  
  // 检查推文是否已下载完成
  async isTweetDownloaded(username, tweetId) {
    try {
      return await this.db.isTweetDownloaded(username, tweetId);
    } catch (error) {
      console.error(`检查推文 ${tweetId} 是否已下载时出错:`, error.message);
      return false;
    }
  }
  
  // 更新推文状态
  async updateTweetStatus(username, tweetId, status, errorMessage = null) {
    try {
      await this.db.updateTweetStatus(username, tweetId, status, errorMessage);
    } catch (error) {
      console.error(`更新推文 ${tweetId} 状态时出错:`, error.message);
    }
  }
  
  // 重试失败的推文下载
  async retryFailedTweets(username) {
    try {
      const failedTweetIds = await this.db.getFailedTweets(username);
      console.log(`发现 ${failedTweetIds.length} 条失败的推文，正在重试下载...`);
      
      let retriedCount = 0;
      let successCount = 0;
      
      for (const tweetId of failedTweetIds) {
        try {
          // 获取推文详情
          const tweetDetail = await this.api.fetchTweetDetail(tweetId);
          if (!tweetDetail.data) {
            console.log(`获取推文 ${tweetId} 详情失败`);
            continue;
          }
          
          retriedCount++;
          await this.updateTweetStatus(username, tweetId, 'downloading');
          
          // 下载推文内容
          await this.downloader.downloadTweet(tweetDetail.data, username);
          await this.updateTweetStatus(username, tweetId, 'completed');
          successCount++;
          
          console.log(`成功重试下载推文: ${tweetId}`);
        } catch (error) {
          console.error(`重试下载推文 ${tweetId} 失败:`, error.message);
          await this.updateTweetStatus(username, tweetId, 'failed', error.message);
        }
        
        // 避免请求过快
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      console.log(`推文重试完成: 共 ${retriedCount} 条，成功 ${successCount} 条`);
    } catch (error) {
      console.error(`获取失败推文列表时出错:`, error.message);
    }
  }
}

module.exports = Monitor;