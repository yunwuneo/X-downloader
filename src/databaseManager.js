const path = require('path');
const { createDatabaseAdapter } = require('./databaseAdapter');

class DatabaseManager {
  constructor(dbPath, options = {}) {
    this.dbPath = dbPath;
    this.options = options;
    
    // 创建数据库适配器
    const dbMode = options.dbMode || 'sqlite'; // 'sqlite' 或 'd1'
    this.adapter = options.dbAdapter || createDatabaseAdapter({
      mode: dbMode,
      dbPath: dbPath,
      d1: options.d1,
      d1Binding: options.d1Binding
    });
    
    this.initPromise = null;
  }

  // 初始化数据库
  async init() {
    if (!this.initPromise) {
      this.initPromise = this.adapter.init();
    }
    return this.initPromise;
  }

  // 关闭数据库连接
  async close() {
    return await this.adapter.close();
  }

  // 获取用户最后一条推文ID
  async getLastTweetId(username) {
    await this.init();
    
    try {
      const row = await this.adapter.get(
        `SELECT last_tweet_id FROM users WHERE username = ?`,
        [username]
      );
      return row ? row.last_tweet_id : null;
    } catch (err) {
      console.error(`获取用户 ${username} 最后推文ID失败:`, err.message);
      throw err;
    }
  }

  // 保存用户最后一条推文ID
  async saveLastTweetId(username, tweetId) {
    await this.init();
    
    try {
      await this.adapter.run(
        `INSERT OR REPLACE INTO users (username, last_tweet_id, last_checked_at)
         VALUES (?, ?, ?)`,
        [username, tweetId, new Date().toISOString()]
      );
    } catch (err) {
      console.error(`保存用户 ${username} 最后推文ID失败:`, err.message);
      throw err;
    }
  }

  // 检查推文是否已下载
  async isTweetDownloaded(username, tweetId) {
    await this.init();
    
    try {
      const row = await this.adapter.get(
        `SELECT status FROM tweets WHERE username = ? AND tweet_id = ?`,
        [username, tweetId]
      );
      // 如果状态为completed，则认为已下载
      return row && row.status === 'completed';
    } catch (err) {
      console.error(`检查推文 ${tweetId} 状态失败:`, err.message);
      throw err;
    }
  }

  // 获取推文状态
  async getTweetStatus(username, tweetId) {
    await this.init();
    
    try {
      const row = await this.adapter.get(
        `SELECT status FROM tweets WHERE username = ? AND tweet_id = ?`,
        [username, tweetId]
      );
      return row ? row.status : null;
    } catch (err) {
      console.error(`获取推文 ${tweetId} 状态失败:`, err.message);
      throw err;
    }
  }

  // 更新推文状态
  async updateTweetStatus(username, tweetId, status, errorMessage = null) {
    await this.init();
    
    try {
      await this.adapter.run(
        `INSERT OR REPLACE INTO tweets (username, tweet_id, status, download_time, error_message)
         VALUES (?, ?, ?, ?, ?)`,
        [username, tweetId, status, new Date().toISOString(), errorMessage]
      );
    } catch (err) {
      console.error(`更新推文 ${tweetId} 状态失败:`, err.message);
      throw err;
    }
  }

  // 获取用户所有失败的推文
  async getFailedTweets(username) {
    await this.init();
    
    try {
      const rows = await this.adapter.all(
        `SELECT tweet_id FROM tweets WHERE username = ? AND status = 'failed'`,
        [username]
      );
      return rows.map(row => row.tweet_id);
    } catch (err) {
      console.error(`获取用户 ${username} 失败推文失败:`, err.message);
      throw err;
    }
  }

  // 获取用户待下载的推文
  async getPendingTweets(username) {
    await this.init();
    
    try {
      const rows = await this.adapter.all(
        `SELECT tweet_id FROM tweets WHERE username = ? AND status = 'pending'`,
        [username]
      );
      return rows.map(row => row.tweet_id);
    } catch (err) {
      console.error(`获取用户 ${username} 待下载推文失败:`, err.message);
      throw err;
    }
  }

  // 获取用户已下载的推文数量
  async getDownloadedTweetsCount(username) {
    await this.init();
    
    try {
      const row = await this.adapter.get(
        `SELECT COUNT(*) as count FROM tweets WHERE username = ? AND status = 'completed'`,
        [username]
      );
      return row ? row.count : 0;
    } catch (err) {
      console.error(`获取用户 ${username} 下载统计失败:`, err.message);
      throw err;
    }
  }

  // 删除用户所有记录
  async clearUserData(username) {
    await this.init();
    
    try {
      // 先删除推文记录
      await this.adapter.run(
        `DELETE FROM tweets WHERE username = ?`,
        [username]
      );
      
      // 再删除用户记录
      await this.adapter.run(
        `DELETE FROM users WHERE username = ?`,
        [username]
      );
    } catch (err) {
      console.error(`删除用户 ${username} 记录失败:`, err.message);
      throw err;
    }
  }

  // 获取用户资料缓存
  async getUserProfile(username) {
    await this.init();
    
    try {
      const row = await this.adapter.get(
        `SELECT * FROM user_profiles WHERE username = ?`,
        [username]
      );
      return row;
    } catch (err) {
      console.error(`获取用户 ${username} 资料缓存失败:`, err.message);
      throw err;
    }
  }

  // 保存用户资料缓存
  async saveUserProfile(username, name, avatar, profileUrl) {
    await this.init();
    
    try {
      const now = new Date().toISOString();
      await this.adapter.run(
        `INSERT OR REPLACE INTO user_profiles (username, name, avatar, profile_url, cached_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [username, name, avatar, profileUrl, now, now]
      );
    } catch (err) {
      console.error(`保存用户 ${username} 资料缓存失败:`, err.message);
      throw err;
    }
  }

  // 删除用户资料缓存
  async deleteUserProfile(username) {
    await this.init();
    
    try {
      await this.adapter.run(
        `DELETE FROM user_profiles WHERE username = ?`,
        [username]
      );
    } catch (err) {
      console.error(`删除用户 ${username} 资料缓存失败:`, err.message);
      throw err;
    }
  }
}

module.exports = DatabaseManager;