const path = require('path');
const { createStorageAdapter } = require('./storageAdapter');

class Downloader {
  constructor(options) {
    this.downloadDir = options.downloadDir;
    this.downloadOptions = options.downloadOptions;
    this.proxyUrl = options.proxyUrl || null;
    
    // 创建存储适配器（支持本地和S3）
    this.storage = options.storageAdapter || createStorageAdapter({
      mode: options.storageMode || 'local',
      baseDir: options.downloadDir,
      s3Bucket: options.s3Bucket,
      s3Region: options.s3Region,
      s3BasePrefix: options.s3BasePrefix,
      s3AccessKeyId: options.s3AccessKeyId,
      s3SecretAccessKey: options.s3SecretAccessKey
    });
  }
  
  // 下载单条推文
  async downloadTweet(tweet, username) {
    const userDir = path.join(this.downloadDir, username);
    await this.storage.ensureDir(userDir);
    
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
    await this.storage.ensureDir(textDir);
    
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
    await this.storage.writeJson(filePath, tweetData, { spaces: 2 });
    console.log(`已下载文本: ${filePath}`);
  }
  
  // 下载照片
  async downloadPhoto(photo, tweetId, userDir) {
    const photoDir = path.join(userDir, 'photos');
    await this.storage.ensureDir(photoDir);
    
    const url = photo.media_url_https;
    const fileName = `${tweetId}_${photo.id}${path.extname(url)}`;
    const filePath = path.join(photoDir, fileName);
    
    try {
      await this.storage.downloadFile(url, filePath, this.proxyUrl);
      console.log(`已下载照片: ${filePath}`);
    } catch (error) {
      console.error(`下载照片失败 ${url}:`, error.message);
    }
  }
  
  // 下载视频
  async downloadVideo(video, tweetId, userDir) {
    const videoDir = path.join(userDir, 'videos');
    await this.storage.ensureDir(videoDir);
    
    // 选择合适的视频质量
    const videoUrl = this.selectVideoUrl(video.variants);
    if (!videoUrl) {
      console.error(`未找到合适的视频URL: ${tweetId}`);
      return;
    }
    
    const fileName = `${tweetId}_${video.id}.mp4`;
    const filePath = path.join(videoDir, fileName);
    
    try {
      await this.storage.downloadFile(videoUrl, filePath, this.proxyUrl);
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
  
  
  // 获取用户下载统计
  async getDownloadStats(username) {
    const userDir = path.join(this.downloadDir, username);
    
    if (!await this.storage.pathExists(userDir)) {
      return { text: 0, photos: 0, videos: 0 };
    }
    
    const stats = {
      text: 0,
      photos: 0,
      videos: 0
    };
    
    // 统计文本文件
    const textDir = path.join(userDir, 'text');
    if (await this.storage.pathExists(textDir)) {
      const textFiles = await this.storage.readdir(textDir);
      stats.text = textFiles.filter(f => f.endsWith('.json')).length;
    }
    
    // 统计照片文件
    const photoDir = path.join(userDir, 'photos');
    if (await this.storage.pathExists(photoDir)) {
      const photoFiles = await this.storage.readdir(photoDir);
      stats.photos = photoFiles.filter(f => 
        ['.jpg', '.jpeg', '.png', '.gif'].includes(path.extname(f).toLowerCase())
      ).length;
    }
    
    // 统计视频文件
    const videoDir = path.join(userDir, 'videos');
    if (await this.storage.pathExists(videoDir)) {
      const videoFiles = await this.storage.readdir(videoDir);
      stats.videos = videoFiles.filter(f => f.endsWith('.mp4')).length;
    }
    
    return stats;
  }
}

module.exports = Downloader;