const sqlite3 = require('sqlite3').verbose();
const path = require('path');

/**
 * 数据库适配器基类
 */
class DatabaseAdapter {
  constructor(options) {
    this.options = options;
  }

  /**
   * 初始化数据库
   */
  async init() {
    throw new Error('init must be implemented by subclass');
  }

  /**
   * 关闭数据库连接
   */
  async close() {
    throw new Error('close must be implemented by subclass');
  }

  /**
   * 执行查询（返回单行）
   */
  async get(sql, params = []) {
    throw new Error('get must be implemented by subclass');
  }

  /**
   * 执行查询（返回多行）
   */
  async all(sql, params = []) {
    throw new Error('all must be implemented by subclass');
  }

  /**
   * 执行更新（INSERT/UPDATE/DELETE）
   */
  async run(sql, params = []) {
    throw new Error('run must be implemented by subclass');
  }

  /**
   * 执行多个SQL语句（用于创建表等）
   */
  async exec(sql) {
    throw new Error('exec must be implemented by subclass');
  }
}

/**
 * SQLite数据库适配器（本地模式）
 */
class SQLiteDatabaseAdapter extends DatabaseAdapter {
  constructor(options) {
    super(options);
    this.dbPath = options.dbPath;
    this.db = null;
    this.initPromise = null;
  }

  async init() {
    if (!this.initPromise) {
      this.initPromise = new Promise((resolve, reject) => {
        this.db = new sqlite3.Database(this.dbPath, (err) => {
          if (err) {
            console.error('连接SQLite数据库失败:', err.message);
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
                status TEXT DEFAULT 'pending',
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
            
            // 创建用户资料缓存表
            this.db.run(
              `CREATE TABLE IF NOT EXISTS user_profiles (
                username TEXT PRIMARY KEY,
                name TEXT,
                avatar TEXT,
                profile_url TEXT,
                cached_at TIMESTAMP,
                updated_at TIMESTAMP
              )`,
              (err) => {
                if (err) {
                  console.error('创建用户资料表失败:', err.message);
                  reject(err);
                } else {
                  resolve();
                }
              }
            );
          });
        });
      });
    }
    
    return this.initPromise;
  }

  async close() {
    if (this.db) {
      return new Promise((resolve, reject) => {
        this.db.close((err) => {
          if (err) {
            console.error('关闭数据库连接失败:', err.message);
            reject(err);
          } else {
            console.log('成功关闭数据库连接');
            resolve();
          }
        });
      });
    }
  }

  async get(sql, params = []) {
    await this.init();
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }

  async all(sql, params = []) {
    await this.init();
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows || []);
        }
      });
    });
  }

  async run(sql, params = []) {
    await this.init();
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function(err) {
        if (err) {
          reject(err);
        } else {
          resolve({ lastID: this.lastID, changes: this.changes });
        }
      });
    });
  }

  async exec(sql) {
    await this.init();
    return new Promise((resolve, reject) => {
      this.db.exec(sql, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }
}

/**
 * Cloudflare D1数据库适配器（Serverless模式）
 * 参考: https://developers.cloudflare.com/d1/
 */
class D1DatabaseAdapter extends DatabaseAdapter {
  constructor(options) {
    super(options);
    // D1绑定可以通过env对象或直接传递的D1实例
    this.d1 = options.d1 || options.d1Binding || null;
    this.initPromise = null;
  }

  async init() {
    if (!this.initPromise) {
      this.initPromise = (async () => {
        // 如果没有提供D1绑定，尝试从环境变量获取
        if (!this.d1) {
          // 在Cloudflare Workers环境中，D1绑定通常通过env提供
          // 这里我们假设通过options传递，或者在运行时通过全局变量获取
          if (typeof globalThis !== 'undefined' && globalThis.env && globalThis.env.DB) {
            this.d1 = globalThis.env.DB;
          } else if (process.env.D1_BINDING_NAME && typeof globalThis !== 'undefined' && globalThis.env) {
            this.d1 = globalThis.env[process.env.D1_BINDING_NAME];
          }
        }

        if (!this.d1) {
          throw new Error('D1数据库绑定未提供。请确保在Cloudflare Workers环境中正确配置D1绑定。');
        }

        console.log('成功连接到Cloudflare D1数据库');

        // 创建表（D1使用SQLite语法，兼容）
        try {
          // 创建用户表
          await this.d1.exec(`CREATE TABLE IF NOT EXISTS users (
            username TEXT PRIMARY KEY,
            last_tweet_id TEXT,
            last_checked_at TEXT
          )`);

          // 创建推文表
          await this.d1.exec(`CREATE TABLE IF NOT EXISTS tweets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT,
            tweet_id TEXT,
            status TEXT DEFAULT 'pending',
            download_time TEXT,
            error_message TEXT,
            FOREIGN KEY (username) REFERENCES users(username),
            UNIQUE(username, tweet_id)
          )`);

          // 创建用户资料缓存表
          await this.d1.exec(`CREATE TABLE IF NOT EXISTS user_profiles (
            username TEXT PRIMARY KEY,
            name TEXT,
            avatar TEXT,
            profile_url TEXT,
            cached_at TEXT,
            updated_at TEXT
          )`);

          console.log('D1数据库表初始化成功');
        } catch (error) {
          console.error('D1数据库表初始化失败:', error.message);
          throw error;
        }
      })();
    }
    
    return this.initPromise;
  }

  async close() {
    // D1是serverless的，不需要关闭连接
    return Promise.resolve();
  }

  async get(sql, params = []) {
    await this.init();
    try {
      const stmt = this.d1.prepare(sql);
      const result = await stmt.bind(...params).first();
      return result || null;
    } catch (error) {
      console.error('D1查询失败:', error.message);
      throw error;
    }
  }

  async all(sql, params = []) {
    await this.init();
    try {
      const stmt = this.d1.prepare(sql);
      const result = await stmt.bind(...params).all();
      return result.results || [];
    } catch (error) {
      console.error('D1查询失败:', error.message);
      throw error;
    }
  }

  async run(sql, params = []) {
    await this.init();
    try {
      const stmt = this.d1.prepare(sql);
      const result = await stmt.bind(...params).run();
      return {
        lastID: result.meta.last_row_id || null,
        changes: result.meta.changes || 0
      };
    } catch (error) {
      console.error('D1执行失败:', error.message);
      throw error;
    }
  }

  async exec(sql) {
    await this.init();
    try {
      await this.d1.exec(sql);
    } catch (error) {
      console.error('D1执行SQL失败:', error.message);
      throw error;
    }
  }
}

/**
 * 创建数据库适配器实例
 */
function createDatabaseAdapter(options) {
  const mode = options.mode || 'sqlite'; // 'sqlite' 或 'd1'
  
  if (mode === 'd1') {
    return new D1DatabaseAdapter({
      d1: options.d1,
      d1Binding: options.d1Binding
    });
  } else {
    return new SQLiteDatabaseAdapter({
      dbPath: options.dbPath
    });
  }
}

module.exports = {
  DatabaseAdapter,
  SQLiteDatabaseAdapter,
  D1DatabaseAdapter,
  createDatabaseAdapter
};

