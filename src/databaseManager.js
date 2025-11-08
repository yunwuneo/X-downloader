const sqlite3 = require('sqlite3').verbose();
const path = require('path');

class DatabaseManager {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.db = null;
    this.initPromise = null;
  }

  // 初始化数据库
  async init() {
    // 使用Promise缓存避免重复初始化
    if (!this.initPromise) {
      this.initPromise = new Promise((resolve, reject) => {
        this.db = new sqlite3.Database(this.dbPath, (err) => {
          if (err) {
            console.error('连接数据库失败:', err.message);
            reject(err);
            return;
          }
          
          console.log('成功连接到SQLite数据库');
          
          // 创建表
          this.db.serialize(() => {
            // 创建用户表
            this.db.run(
              `CREATE TABLE IF NOT EXISTS users (
                username TEXT PRIMARY KEY,
                last_tweet_id TEXT,
                last_checked_at TIMESTAMP
              )`,
              (err) => {
                if (err) {
                  console.error('创建用户表失败:', err.message);
                  reject(err);
                }
              }
            );
            
            // 创建推文表
            this.db.run(
              `CREATE TABLE IF NOT EXISTS tweets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT,
                tweet_id TEXT,
                status TEXT DEFAULT 'pending', -- pending, downloading, completed, failed
                download_time TIMESTAMP,
                error_message TEXT,
                FOREIGN KEY (username) REFERENCES users(username),
                UNIQUE(username, tweet_id)
              )`,
              (err) => {
                if (err) {
                  console.error('创建推文表失败:', err.message);
                  reject(err);
                }
              }
            );
          });
          
          resolve();
        });
      });
    }
    
    return this.initPromise;
  }

  // 关闭数据库连接
  close() {
    if (this.db) {
      this.db.close((err) => {
        if (err) {
          console.error('关闭数据库连接失败:', err.message);
        } else {
          console.log('成功关闭数据库连接');
        }
      });
    }
  }

  // 获取用户最后一条推文ID
  async getLastTweetId(username) {
    await this.init();
    
    return new Promise((resolve, reject) => {
      this.db.get(
        `SELECT last_tweet_id FROM users WHERE username = ?`,
        [username],
        (err, row) => {
          if (err) {
            console.error(`获取用户 ${username} 最后推文ID失败:`, err.message);
            reject(err);
          } else {
            resolve(row ? row.last_tweet_id : null);
          }
        }
      );
    });
  }

  // 保存用户最后一条推文ID
  async saveLastTweetId(username, tweetId) {
    await this.init();
    
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT OR REPLACE INTO users (username, last_tweet_id, last_checked_at)
         VALUES (?, ?, ?)`,
        [username, tweetId, new Date().toISOString()],
        (err) => {
          if (err) {
            console.error(`保存用户 ${username} 最后推文ID失败:`, err.message);
            reject(err);
          } else {
            resolve();
          }
        }
      );
    });
  }

  // 检查推文是否已下载
  async isTweetDownloaded(username, tweetId) {
    await this.init();
    
    return new Promise((resolve, reject) => {
      this.db.get(
        `SELECT status FROM tweets WHERE username = ? AND tweet_id = ?`,
        [username, tweetId],
        (err, row) => {
          if (err) {
            console.error(`检查推文 ${tweetId} 状态失败:`, err.message);
            reject(err);
          } else {
            // 如果状态为completed，则认为已下载
            resolve(row && row.status === 'completed');
          }
        }
      );
    });
  }

  // 获取推文状态
  async getTweetStatus(username, tweetId) {
    await this.init();
    
    return new Promise((resolve, reject) => {
      this.db.get(
        `SELECT status FROM tweets WHERE username = ? AND tweet_id = ?`,
        [username, tweetId],
        (err, row) => {
          if (err) {
            console.error(`获取推文 ${tweetId} 状态失败:`, err.message);
            reject(err);
          } else {
            resolve(row ? row.status : null);
          }
        }
      );
    });
  }

  // 更新推文状态
  async updateTweetStatus(username, tweetId, status, errorMessage = null) {
    await this.init();
    
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT OR REPLACE INTO tweets (username, tweet_id, status, download_time, error_message)
         VALUES (?, ?, ?, ?, ?)`,
        [username, tweetId, status, new Date().toISOString(), errorMessage],
        (err) => {
          if (err) {
            console.error(`更新推文 ${tweetId} 状态失败:`, err.message);
            reject(err);
          } else {
            resolve();
          }
        }
      );
    });
  }

  // 获取用户所有失败的推文
  async getFailedTweets(username) {
    await this.init();
    
    return new Promise((resolve, reject) => {
      this.db.all(
        `SELECT tweet_id FROM tweets WHERE username = ? AND status = 'failed'`,
        [username],
        (err, rows) => {
          if (err) {
            console.error(`获取用户 ${username} 失败推文失败:`, err.message);
            reject(err);
          } else {
            resolve(rows.map(row => row.tweet_id));
          }
        }
      );
    });
  }

  // 获取用户待下载的推文
  async getPendingTweets(username) {
    await this.init();
    
    return new Promise((resolve, reject) => {
      this.db.all(
        `SELECT tweet_id FROM tweets WHERE username = ? AND status = 'pending'`,
        [username],
        (err, rows) => {
          if (err) {
            console.error(`获取用户 ${username} 待下载推文失败:`, err.message);
            reject(err);
          } else {
            resolve(rows.map(row => row.tweet_id));
          }
        }
      );
    });
  }

  // 获取用户已下载的推文数量
  async getDownloadedTweetsCount(username) {
    await this.init();
    
    return new Promise((resolve, reject) => {
      this.db.get(
        `SELECT COUNT(*) as count FROM tweets WHERE username = ? AND status = 'completed'`,
        [username],
        (err, row) => {
          if (err) {
            console.error(`获取用户 ${username} 下载统计失败:`, err.message);
            reject(err);
          } else {
            resolve(row ? row.count : 0);
          }
        }
      );
    });
  }

  // 删除用户所有记录
  async clearUserData(username) {
    await this.init();
    
    return new Promise((resolve, reject) => {
      this.db.serialize(() => {
        // 先删除推文记录
        this.db.run(
          `DELETE FROM tweets WHERE username = ?`,
          [username],
          (err) => {
            if (err) {
              console.error(`删除用户 ${username} 推文记录失败:`, err.message);
              reject(err);
            }
          }
        );
        
        // 再删除用户记录
        this.db.run(
          `DELETE FROM users WHERE username = ?`,
          [username],
          (err) => {
            if (err) {
              console.error(`删除用户 ${username} 记录失败:`, err.message);
              reject(err);
            } else {
              resolve();
            }
          }
        );
      });
    });
  }
}

module.exports = DatabaseManager;