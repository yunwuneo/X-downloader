const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');

class Downloader {
  constructor(options) {
    this.downloadDir = options.downloadDir;
    this.downloadOptions = options.downloadOptions;
    this.proxyUrl = options.proxyUrl || null;
  }
  
  // 下载单条推文
  async downloadTweet(tweet, username) {
    const userDir = path.join(this.downloadDir, username);
    await fs.ensureDir(userDir);
    
    // 下载文本内容
    if (this.downloadOptions.downloadText) {
      await this.downloadText(tweet, userDir);
    }
    
    // 下载媒体内容
    if (tweet.media) {
      // 下载照片
      if (tweet.media.photo && this.downloadOptions.downloadPhotos) {
        for (const photo of tweet.media.photo) {
          await this.downloadPhoto(photo, tweet.tweet_id, userDir);
        }
      }
      
      // 下载视频
      if (tweet.media.video && this.downloadOptions.downloadVideos) {
        for (const video of tweet.media.video) {
          await this.downloadVideo(video, tweet.tweet_id, userDir);
        }
      }
    }
  }
  
  // 下载文本内容
  async downloadText(tweet, userDir) {
    const textDir = path.join(userDir, 'text');
    await fs.ensureDir(textDir);
    
    const tweetData = {
      tweet_id: tweet.tweet_id,
      created_at: tweet.created_at,
      text: tweet.text,
      favorites: tweet.favorites,
      retweets: tweet.retweets,
      replies: tweet.replies,
      quotes: tweet.quotes,
      views: tweet.views,
      author: tweet.author
    };
    
    const filePath = path.join(textDir, `${tweet.tweet_id}.json`);
    await fs.writeJson(filePath, tweetData, { spaces: 2 });
    console.log(`已下载文本: ${filePath}`);
  }
  
  // 下载照片
  async downloadPhoto(photo, tweetId, userDir) {
    const photoDir = path.join(userDir, 'photos');
    await fs.ensureDir(photoDir);
    
    const url = photo.media_url_https;
    const fileName = `${tweetId}_${photo.id}${path.extname(url)}`;
    const filePath = path.join(photoDir, fileName);
    
    try {
      await this.downloadFile(url, filePath);
      console.log(`已下载照片: ${filePath}`);
    } catch (error) {
      console.error(`下载照片失败 ${url}:`, error.message);
    }
  }
  
  // 下载视频
  async downloadVideo(video, tweetId, userDir) {
    const videoDir = path.join(userDir, 'videos');
    await fs.ensureDir(videoDir);
    
    // 选择合适的视频质量
    const videoUrl = this.selectVideoUrl(video.variants);
    if (!videoUrl) {
      console.error(`未找到合适的视频URL: ${tweetId}`);
      return;
    }
    
    const fileName = `${tweetId}_${video.id}.mp4`;
    const filePath = path.join(videoDir, fileName);
    
    try {
      await this.downloadFile(videoUrl, filePath);
      console.log(`已下载视频: ${filePath}`);
    } catch (error) {
      console.error(`下载视频失败 ${videoUrl}:`, error.message);
    }
  }
  
  // 选择视频URL
  selectVideoUrl(variants) {
    // 过滤出MP4格式的视频
    const mp4Variants = variants.filter(v => 
      v.content_type === 'video/mp4' && v.url
    );
    
    if (mp4Variants.length === 0) {
      return null;
    }
    
    // 根据质量选择
    if (this.downloadOptions.videoQuality === 'highest') {
      // 按比特率降序排序
      mp4Variants.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
    } else {
      // 按比特率升序排序
      mp4Variants.sort((a, b) => (a.bitrate || 0) - (b.bitrate || 0));
    }
    
    return mp4Variants[0].url;
  }
  
  // 下载文件
  async downloadFile(url, filePath) {
    // 检查文件是否已存在
    if (await fs.pathExists(filePath)) {
      console.log(`文件已存在，跳过下载: ${filePath}`);
      return;
    }
    
    // 构建axios配置
    const axiosConfig = {
      url,
      method: 'GET',
      responseType: 'stream'
    };
    
    // 如果设置了代理，添加代理配置
    if (this.proxyUrl) {
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
    
    const response = await axios(axiosConfig);
    
    const writer = fs.createWriteStream(filePath);
    response.data.pipe(writer);
    
    return new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
  }
  
  // 获取用户下载统计
  async getDownloadStats(username) {
    const userDir = path.join(this.downloadDir, username);
    
    if (!await fs.pathExists(userDir)) {
      return { text: 0, photos: 0, videos: 0 };
    }
    
    const stats = {
      text: 0,
      photos: 0,
      videos: 0
    };
    
    // 统计文本文件
    const textDir = path.join(userDir, 'text');
    if (await fs.pathExists(textDir)) {
      const textFiles = await fs.readdir(textDir);
      stats.text = textFiles.filter(f => f.endsWith('.json')).length;
    }
    
    // 统计照片文件
    const photoDir = path.join(userDir, 'photos');
    if (await fs.pathExists(photoDir)) {
      const photoFiles = await fs.readdir(photoDir);
      stats.photos = photoFiles.filter(f => 
        ['.jpg', '.jpeg', '.png', '.gif'].includes(path.extname(f).toLowerCase())
      ).length;
    }
    
    // 统计视频文件
    const videoDir = path.join(userDir, 'videos');
    if (await fs.pathExists(videoDir)) {
      const videoFiles = await fs.readdir(videoDir);
      stats.videos = videoFiles.filter(f => f.endsWith('.mp4')).length;
    }
    
    return stats;
  }
}

module.exports = Downloader;