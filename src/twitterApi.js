const axios = require('axios');

class TwitterApi {
  constructor(options) {
    this.apiKey = options.apiKey;
    this.apiBaseUrl = options.apiBaseUrl || 'https://api.tikhub.io';
    this.proxyUrl = options.proxyUrl || null;
    
    // 构建axios配置
    const axiosConfig = {
      baseURL: this.apiBaseUrl,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      }
    };
    
    // 如果设置了代理，添加代理配置
    if (this.proxyUrl) {
      console.log(`使用代理: ${this.proxyUrl}`);
      axiosConfig.proxy = {
        host: new URL(this.proxyUrl).hostname,
        port: parseInt(new URL(this.proxyUrl).port),
        protocol: new URL(this.proxyUrl).protocol.replace(':', '')
      };
      
      // 如果代理URL包含认证信息
      const auth = new URL(this.proxyUrl).auth;
      if (auth) {
        const [username, password] = auth.split(':');
        axiosConfig.proxy.auth = {
          username,
          password
        };
      }
    }
    
    // 初始化axios实例
    this.client = axios.create(axiosConfig);
  }
  
  // 获取用户媒体（支持分页）
  async fetchUserMedia(screenName, cursor = '') {
    try {
      // 构建查询参数
      const params = {
        screen_name: screenName
      };
      // 只有当cursor不为空时才添加到参数中
      if (cursor) {
        params.cursor = cursor;
      }
      const response = await this.client.get('/api/v1/twitter/web/fetch_user_media', { params });
      
      return response.data;
    } catch (error) {
      console.error('获取用户媒体时出错:', error.response?.data || error.message);
      throw new Error(`获取用户 ${screenName} 媒体失败: ${error.message}`);
    }
  }
  
  // 获取用户发帖
  async fetchUserPosts(screenName, cursor = '') {
    try {
      const response = await this.client.get('/api/v1/twitter/web/fetch_user_post_tweet', {
        params: {
          screen_name: screenName,
          cursor: cursor
        }
      });
      
      return response.data;
    } catch (error) {
      console.error('获取用户发帖时出错:', error.response?.data || error.message);
      throw new Error(`获取用户 ${screenName} 发帖失败: ${error.message}`);
    }
  }
  
  // 获取单个推文详情
  async fetchTweetDetail(tweetId) {
    try {
      const response = await this.client.get('/api/v1/twitter/web/fetch_tweet_detail', {
        params: {
          tweet_id: tweetId
        }
      });
      
      return response.data;
    } catch (error) {
      console.error('获取推文详情时出错:', error.response?.data || error.message);
      throw new Error(`获取推文 ${tweetId} 详情失败: ${error.message}`);
    }
  }
  
  // 分页获取所有用户媒体
  async fetchAllUserMedia(screenName) {
    let allMedia = [];
    let cursor = '';
    let hasMore = true;
    
    while (hasMore) {
      const response = await this.fetchUserMedia(screenName, cursor);
      
      if (response.data && response.data.timeline) {
        allMedia = [...allMedia, ...response.data.timeline];
      }
      
      // 检查是否有下一页
      if (response.data && response.data.next_cursor) {
        cursor = response.data.next_cursor;
        // 避免请求过快
        await new Promise(resolve => setTimeout(resolve, 1000));
      } else {
        hasMore = false;
      }
    }
    
    return allMedia;
  }
}

module.exports = TwitterApi;