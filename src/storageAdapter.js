const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const { S3Client, PutObjectCommand, HeadObjectCommand, GetObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');

/**
 * 存储适配器基类
 */
class StorageAdapter {
  constructor(options) {
    this.options = options;
  }

  /**
   * 确保目录存在（对于S3，这个操作可能不需要）
   */
  async ensureDir(dirPath) {
    throw new Error('ensureDir must be implemented by subclass');
  }

  /**
   * 检查文件是否存在
   */
  async pathExists(filePath) {
    throw new Error('pathExists must be implemented by subclass');
  }

  /**
   * 写入文件
   */
  async writeFile(filePath, data, options = {}) {
    throw new Error('writeFile must be implemented by subclass');
  }

  /**
   * 写入JSON文件
   */
  async writeJson(filePath, data, options = {}) {
    const jsonString = JSON.stringify(data, null, options.spaces || 2);
    return await this.writeFile(filePath, jsonString, options);
  }

  /**
   * 下载文件并保存
   */
  async downloadFile(url, filePath, proxyUrl = null) {
    throw new Error('downloadFile must be implemented by subclass');
  }

  /**
   * 读取目录
   */
  async readdir(dirPath) {
    throw new Error('readdir must be implemented by subclass');
  }
}

/**
 * 本地文件系统存储适配器
 */
class LocalStorageAdapter extends StorageAdapter {
  constructor(options) {
    super(options);
    this.baseDir = options.baseDir || './downloads';
  }

  async ensureDir(dirPath) {
    await fs.ensureDir(dirPath);
  }

  async pathExists(filePath) {
    return await fs.pathExists(filePath);
  }

  async writeFile(filePath, data, options = {}) {
    // 确保目录存在
    const dir = path.dirname(filePath);
    await fs.ensureDir(dir);
    
    if (typeof data === 'string') {
      await fs.writeFile(filePath, data, options);
    } else {
      await fs.writeFile(filePath, data);
    }
  }

  async downloadFile(url, filePath, proxyUrl = null) {
    // 检查文件是否已存在
    if (await this.pathExists(filePath)) {
      console.log(`文件已存在，跳过下载: ${filePath}`);
      return;
    }

    // 确保目录存在
    const dir = path.dirname(filePath);
    await fs.ensureDir(dir);

    // 构建axios配置
    const axiosConfig = {
      url,
      method: 'GET',
      responseType: 'stream'
    };

    // 如果设置了代理，添加代理配置
    if (proxyUrl) {
      const proxyUrlObj = new URL(proxyUrl);
      axiosConfig.proxy = {
        host: proxyUrlObj.hostname,
        port: parseInt(proxyUrlObj.port),
        protocol: proxyUrlObj.protocol.replace(':', '')
      };

      // 如果代理URL包含认证信息
      if (proxyUrlObj.auth) {
        const [username, password] = proxyUrlObj.auth.split(':');
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

  async readdir(dirPath) {
    if (await fs.pathExists(dirPath)) {
      return await fs.readdir(dirPath);
    }
    return [];
  }
}

/**
 * S3存储适配器（支持AWS S3及所有S3兼容API，如Cloudflare R2、DigitalOcean Spaces等）
 */
class S3StorageAdapter extends StorageAdapter {
  constructor(options) {
    super(options);
    
    // S3配置
    this.bucket = options.bucket;
    this.region = options.region || 'us-east-1';
    this.basePrefix = options.basePrefix || 'downloads'; // S3中的基础路径前缀
    
    // 初始化S3客户端
    const s3Config = {
      region: this.region
    };

    // 如果提供了自定义endpoint（用于S3兼容服务，如Cloudflare R2）
    if (options.endpoint) {
      s3Config.endpoint = options.endpoint;
      // 某些S3兼容服务需要forcePathStyle
      s3Config.forcePathStyle = options.forcePathStyle !== false; // 默认true
    }

    // 如果提供了访问密钥，使用它们
    if (options.accessKeyId && options.secretAccessKey) {
      s3Config.credentials = {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey
      };
    }
    // 否则使用默认的AWS凭证链（环境变量、IAM角色等）

    this.s3Client = new S3Client(s3Config);
  }

  /**
   * 将本地路径转换为S3键
   */
  _getS3Key(filePath) {
    // 移除基础目录前缀，只保留相对路径
    let relativePath = filePath;
    if (filePath.startsWith('./')) {
      relativePath = filePath.substring(2);
    }
    
    // 组合S3键
    return `${this.basePrefix}/${relativePath}`.replace(/\\/g, '/');
  }

  /**
   * 对于S3，ensureDir不需要实际操作
   */
  async ensureDir(dirPath) {
    // S3是扁平存储，不需要创建目录
    return Promise.resolve();
  }

  /**
   * 检查文件是否存在于S3
   */
  async pathExists(filePath) {
    try {
      const key = this._getS3Key(filePath);
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: key
      });
      await this.s3Client.send(command);
      return true;
    } catch (error) {
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        return false;
      }
      throw error;
    }
  }

  /**
   * 写入文件到S3
   */
  async writeFile(filePath, data, options = {}) {
    const key = this._getS3Key(filePath);
    
    // 确定Content-Type
    let contentType = 'application/octet-stream';
    const ext = path.extname(filePath).toLowerCase();
    const contentTypes = {
      '.json': 'application/json',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.mp4': 'video/mp4',
      '.webp': 'image/webp'
    };
    if (contentTypes[ext]) {
      contentType = contentTypes[ext];
    }

    // 如果是字符串，转换为Buffer
    const body = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: body,
      ContentType: contentType
    });

    await this.s3Client.send(command);
    console.log(`已上传到S3: s3://${this.bucket}/${key}`);
  }

  /**
   * 从URL下载文件并上传到S3
   */
  async downloadFile(url, filePath, proxyUrl = null) {
    // 检查文件是否已存在
    if (await this.pathExists(filePath)) {
      console.log(`文件已存在于S3，跳过下载: ${filePath}`);
      return;
    }

    // 构建axios配置
    const axiosConfig = {
      url,
      method: 'GET',
      responseType: 'stream'
    };

    // 如果设置了代理，添加代理配置
    if (proxyUrl) {
      const proxyUrlObj = new URL(proxyUrl);
      axiosConfig.proxy = {
        host: proxyUrlObj.hostname,
        port: parseInt(proxyUrlObj.port),
        protocol: proxyUrlObj.protocol.replace(':', '')
      };

      // 如果代理URL包含认证信息
      if (proxyUrlObj.auth) {
        const [username, password] = proxyUrlObj.auth.split(':');
        axiosConfig.proxy.auth = {
          username,
          password
        };
      }
    }

    // 下载文件到内存
    const response = await axios({
      ...axiosConfig,
      responseType: 'arraybuffer'
    });

    // 上传到S3
    await this.writeFile(filePath, response.data);
    console.log(`已下载并上传到S3: ${filePath}`);
  }

  /**
   * 读取S3目录（列出指定前缀的所有对象）
   */
  async readdir(dirPath) {
    try {
      const prefix = this._getS3Key(dirPath);
      // 确保前缀以/结尾
      const s3Prefix = prefix.endsWith('/') ? prefix : `${prefix}/`;
      
      const command = new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: s3Prefix,
        Delimiter: '/'
      });

      const response = await this.s3Client.send(command);
      
      // 提取文件名
      const files = [];
      if (response.Contents) {
        for (const obj of response.Contents) {
          const fileName = path.basename(obj.Key);
          if (fileName) {
            files.push(fileName);
          }
        }
      }
      
      return files;
    } catch (error) {
      console.error(`读取S3目录失败: ${dirPath}`, error.message);
      return [];
    }
  }
}

/**
 * 创建存储适配器实例
 */
function createStorageAdapter(options) {
  const mode = options.mode || 'local'; // 'local' 或 's3'
  
  if (mode === 's3') {
    return new S3StorageAdapter({
      bucket: options.s3Bucket,
      region: options.s3Region || process.env.S3_REGION || process.env.AWS_REGION || 'us-east-1',
      basePrefix: options.s3BasePrefix || 'downloads',
      endpoint: options.s3Endpoint || process.env.S3_ENDPOINT, // S3兼容服务的endpoint
      forcePathStyle: options.s3ForcePathStyle !== undefined ? options.s3ForcePathStyle : 
                      (process.env.S3_FORCE_PATH_STYLE === 'true'), // 某些服务需要路径样式
      accessKeyId: options.s3AccessKeyId || process.env.S3_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: options.s3SecretAccessKey || process.env.S3_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY
    });
  } else {
    return new LocalStorageAdapter({
      baseDir: options.baseDir || './downloads'
    });
  }
}

module.exports = {
  StorageAdapter,
  LocalStorageAdapter,
  S3StorageAdapter,
  createStorageAdapter
};

