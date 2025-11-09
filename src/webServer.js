const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');

function WebServer(options) {
  this.port = options.port || 3000;
  this.monitor = options.monitor;
  this.server = null;
}

// 启动Web服务器
WebServer.prototype.start = function() {
  try {
    this.server = http.createServer(this.handleRequest.bind(this));
    
    // 添加错误处理
    this.server.on('error', function(err) {
      if (err.code === 'EADDRINUSE') {
        console.error(`端口 ${this.port} 已被占用，请使用其他端口或关闭占用该端口的程序`);
      } else {
        console.error('Web服务器错误:', err.message);
      }
    }.bind(this));
    
    this.server.listen(this.port, function() {
      console.log('Web管理界面已启动，访问地址: http://localhost:' + this.port);
    }.bind(this));
  } catch (error) {
    console.error('启动Web服务器失败:', error.message);
  }
};

// 停止Web服务器
WebServer.prototype.stop = function() {
  if (this.server) {
    this.server.close(function() {
      console.log('Web管理界面已停止');
    });
  }
};

// 处理HTTP请求
WebServer.prototype.handleRequest = function(req, res) {
  try {
    var parsedUrl = url.parse(req.url, true);
    var pathname = parsedUrl.pathname;
    
    // API路由处理
    if (pathname.indexOf('/api/') === 0) {
      this.handleApiRequest(req, res, pathname, parsedUrl.query);
      return;
    }
    
    // 提供静态文件（默认头像）
    if (pathname === '/avatar_default.webp') {
      this.serveDefaultAvatar(res);
      return;
    }
    
    // 提供HTML页面
    this.serveHtmlPage(res);
  } catch (error) {
    console.error('处理请求时出错:', error.message);
    res.writeHead(500);
    res.end(JSON.stringify({ error: '服务器内部错误' }));
  }
};

// 处理API请求
WebServer.prototype.handleApiRequest = function(req, res, pathname, query) {
  try {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    // 记录API请求（用于调试）
    console.log(`[API] ${req.method} ${pathname}`);
    
    // 获取用户列表
    if (pathname === '/api/users' && req.method === 'GET') {
      this.getUsersList(req, res);
    }
    // 添加用户
    else if (pathname === '/api/users' && req.method === 'POST') {
      this.addUserHandler(req, res);
    }
    // 删除用户
    else if (pathname.indexOf('/api/users/') === 0 && req.method === 'DELETE') {
      var username = pathname.split('/')[3];
      this.deleteUserHandler(res, username);
    }
    // 获取下载状态
    else if (pathname === '/api/download/status' && req.method === 'GET') {
      this.getDownloadStatus(res, query.username);
    }
    // 获取统计信息
    else if (pathname === '/api/stats' && req.method === 'GET') {
      this.getStats(res);
    }
  // 重试失败的下载
  else if (pathname === '/api/retry' && req.method === 'POST') {
    this.retryFailedHandler(req, res);
  }
  // 获取用户详细信息
  else if (pathname === '/api/users/details' && req.method === 'GET') {
    this.getUsersDetails(req, res, query);
  }
  // 刷新用户详细信息缓存
  else if (pathname === '/api/users/refresh' && req.method === 'POST') {
    this.refreshUserDetails(req, res);
  }
  else {
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'API端点不存在' }));
  }
  } catch (error) {
    console.error('处理API请求时出错:', error.message);
    res.writeHead(500);
    res.end(JSON.stringify({ error: '服务器内部错误' }));
  }
};

// 获取用户列表
WebServer.prototype.getUsersList = function(req, res) {
  try {
    var users = this.monitor.getUsers();
    // 确保返回的是数组
    if (!Array.isArray(users)) {
      console.warn('警告: getUsers() 返回的不是数组，返回空数组');
      users = [];
    }
    console.log(`[API] 返回用户列表: ${users.length} 个用户`);
    res.writeHead(200);
    res.end(JSON.stringify({ users: users }));
  } catch (error) {
    console.error('获取用户列表失败:', error.message);
    res.writeHead(500);
    res.end(JSON.stringify({ error: '获取用户列表失败: ' + error.message }));
  }
};

// 添加用户
WebServer.prototype.addUserHandler = function(req, res) {
  var body = '';
  req.on('data', function(chunk) {
    body += chunk;
  });
  
  req.on('end', function() {
    try {
      var data = JSON.parse(body);
      var username = data.username;
      
      if (!username || username.trim() === '') {
        res.writeHead(400);
        res.end(JSON.stringify({ error: '用户名不能为空' }));
        return;
      }
      
      // 规范化用户名（去除空格，转为小写）
      username = username.trim().toLowerCase();
      
      var currentUsers = this.monitor.getUsers();
      // 检查用户是否已存在（不区分大小写）
      var userExists = currentUsers.some(function(user) {
        return user.toLowerCase() === username;
      });
      
      if (userExists) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: '用户已存在' }));
        return;
      }
      
      var newUsers = currentUsers.concat([username]);
      var success = this.monitor.updateUsers(newUsers);
      
      if (success) {
        var self = this;
        // 确保用户资料已缓存（验证时应该已经获取并缓存了）
        // 如果没有缓存，这里会触发一次API调用
        this.monitor.api.fetchUserProfile(username).then(function(response) {
          if (response && response.data) {
            var userInfo = response.data;
            var userData = {
              username: username,
              name: userInfo.name || userInfo.screen_name || username,
              avatar: userInfo.avatar || userInfo.profile_image_url_https || userInfo.profile_image_url || '',
              profileUrl: 'https://twitter.com/' + username
            };
            self.monitor.db.saveUserProfile(
              username,
              userData.name,
              userData.avatar,
              userData.profileUrl
            ).catch(function(err) {
              console.error('保存用户资料缓存失败:', err.message);
            });
          }
        }).catch(function(err) {
          console.error('获取用户资料失败:', err.message);
        });
        
        // 立即检查新用户
        this.monitor.checkUser(username).catch(function(err) {
          console.error('检查新用户失败:', err.message);
        });
        
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, users: newUsers }));
      } else {
        res.writeHead(500);
        res.end(JSON.stringify({ error: '更新用户列表失败' }));
      }
    } catch (e) {
      console.error('添加用户时出错:', e.message);
      res.writeHead(400);
      res.end(JSON.stringify({ error: '请求数据格式错误: ' + e.message }));
    }
  }.bind(this));
  
  req.on('error', function(err) {
    console.error('接收请求数据时出错:', err.message);
    res.writeHead(500);
    res.end(JSON.stringify({ error: '接收请求数据失败' }));
  });
};

// 删除用户
WebServer.prototype.deleteUserHandler = function(res, username) {
  try {
    if (!username) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: '用户名不能为空' }));
      return;
    }
    
    // 规范化用户名
    username = decodeURIComponent(username).trim().toLowerCase();
    
    var currentUsers = this.monitor.getUsers();
    // 查找用户（不区分大小写）
    var index = -1;
    for (var i = 0; i < currentUsers.length; i++) {
      if (currentUsers[i].toLowerCase() === username) {
        index = i;
        break;
      }
    }
    
    if (index === -1) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: '用户不存在' }));
      return;
    }
    
    var newUsers = currentUsers.slice();
    newUsers.splice(index, 1);
    
    var success = this.monitor.updateUsers(newUsers);
    
    if (success) {
      res.writeHead(200);
      res.end(JSON.stringify({ success: true, users: newUsers }));
    } else {
      res.writeHead(500);
      res.end(JSON.stringify({ error: '更新用户列表失败' }));
    }
  } catch (error) {
    console.error('删除用户时出错:', error.message);
    res.writeHead(500);
    res.end(JSON.stringify({ error: '删除用户失败' }));
  }
};

// 获取下载状态
WebServer.prototype.getDownloadStatus = function(res, username) {
  try {
    // 如果提供了用户名，可以返回该用户的下载状态
    if (username) {
      // TODO: 实现从数据库获取用户下载状态的功能
      res.writeHead(200);
      res.end(JSON.stringify({
        status: 'ok',
        username: username,
        message: '功能开发中，请稍后'
      }));
    } else {
      res.writeHead(200);
      res.end(JSON.stringify({
        status: 'ok',
        message: '功能开发中，请稍后'
      }));
    }
  } catch (error) {
    console.error('获取下载状态失败:', error.message);
    res.writeHead(500);
    res.end(JSON.stringify({ error: '获取下载状态失败' }));
  }
};

// 获取统计信息
WebServer.prototype.getStats = function(res) {
  try {
    var users = this.monitor.getUsers();
    res.writeHead(200);
    res.end(JSON.stringify({
      totalUsers: users.length,
      monitorInterval: this.monitor.monitorInterval || 60
    }));
  } catch (error) {
    console.error('获取统计信息失败:', error.message);
    res.writeHead(500);
    res.end(JSON.stringify({ error: '获取统计信息失败' }));
  }
};

// 重试失败的下载
WebServer.prototype.retryFailedHandler = function(req, res) {
  var body = '';
  req.on('data', function(chunk) {
    body += chunk;
  });
  
  req.on('end', function() {
    try {
      var data = JSON.parse(body);
      var username = data.username;
      
      if (!username) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: '用户名不能为空' }));
        return;
      }
      
      // 规范化用户名
      username = username.trim().toLowerCase();
      
      // 检查用户是否存在
      var users = this.monitor.getUsers();
      var userExists = users.some(function(user) {
        return user.toLowerCase() === username;
      });
      
      if (!userExists) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: '用户不存在' }));
        return;
      }
      
      this.monitor.retryFailedTweets(username).then(function() {
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, message: '已开始重试失败的下载' }));
      }).catch(function(err) {
        console.error('重试失败下载时出错:', err.message);
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message || '重试失败' }));
      });
    } catch (e) {
      console.error('处理重试请求时出错:', e.message);
      res.writeHead(400);
      res.end(JSON.stringify({ error: '请求数据格式错误: ' + e.message }));
    }
  }.bind(this));
  
  req.on('error', function(err) {
    console.error('接收请求数据时出错:', err.message);
    res.writeHead(500);
    res.end(JSON.stringify({ error: '接收请求数据失败' }));
  });
};

// 获取用户详细信息（从缓存或API）
WebServer.prototype.getUsersDetails = function(req, res, query) {
  try {
    var username = query.username;
    if (!username) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: '用户名不能为空' }));
      return;
    }
    
    var self = this;
    // 先从数据库缓存读取
    this.monitor.db.getUserProfile(username).then(function(cachedProfile) {
      if (cachedProfile) {
        // 有缓存，直接返回
        var userData = {
          username: cachedProfile.username,
          name: cachedProfile.name || username,
          avatar: cachedProfile.avatar || '',
          profileUrl: cachedProfile.profile_url || 'https://twitter.com/' + username
        };
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, user: userData, cached: true }));
      } else {
        // 没有缓存，从API获取
        self.fetchAndCacheUserProfile(username, res);
      }
    }).catch(function(err) {
      console.error('读取用户资料缓存失败:', err.message);
      // 缓存读取失败，从API获取
      self.fetchAndCacheUserProfile(username, res);
    });
  } catch (error) {
    console.error('处理用户详细信息请求时出错:', error.message);
    res.writeHead(500);
    res.end(JSON.stringify({ error: '处理请求失败' }));
  }
};

// 从API获取并缓存用户资料
WebServer.prototype.fetchAndCacheUserProfile = function(username, res) {
  var self = this;
  this.monitor.api.fetchUserProfile(username).then(function(response) {
    if (response && response.data) {
      var userInfo = response.data;
      var userData = {
        username: username,
        name: userInfo.name || userInfo.screen_name || username,
        avatar: userInfo.avatar || userInfo.profile_image_url_https || userInfo.profile_image_url || '',
        profileUrl: 'https://twitter.com/' + username
      };
      
      // 保存到缓存
      self.monitor.db.saveUserProfile(
        username,
        userData.name,
        userData.avatar,
        userData.profileUrl
      ).catch(function(err) {
        console.error('保存用户资料缓存失败:', err.message);
      });
      
      res.writeHead(200);
      res.end(JSON.stringify({ success: true, user: userData, cached: false }));
    } else {
      res.writeHead(404);
      res.end(JSON.stringify({ error: '未找到用户信息' }));
    }
  }).catch(function(err) {
    console.error('获取用户详细信息失败:', err.message);
    res.writeHead(500);
    res.end(JSON.stringify({ error: '获取用户详细信息失败: ' + err.message }));
  });
};

// 刷新用户详细信息缓存
WebServer.prototype.refreshUserDetails = function(req, res) {
  var body = '';
  req.on('data', function(chunk) {
    body += chunk;
  });
  
  req.on('end', function() {
    try {
      var data = JSON.parse(body);
      var username = data.username;
      
      if (!username) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: '用户名不能为空' }));
        return;
      }
      
      var self = this;
      // 强制从API获取最新数据
      this.fetchAndCacheUserProfile(username, res);
    } catch (e) {
      console.error('处理刷新请求时出错:', e.message);
      res.writeHead(400);
      res.end(JSON.stringify({ error: '请求数据格式错误: ' + e.message }));
    }
  }.bind(this));
  
  req.on('error', function(err) {
    console.error('接收请求数据时出错:', err.message);
    res.writeHead(500);
    res.end(JSON.stringify({ error: '接收请求数据失败' }));
  });
};

// 提供默认头像文件
WebServer.prototype.serveDefaultAvatar = function(res) {
  try {
    var avatarPath = path.join(__dirname, 'avatar_default.webp');
    fs.readFile(avatarPath, function(err, data) {
      if (err) {
        console.error('读取默认头像失败:', err.message);
        res.writeHead(404);
        res.end('Not Found');
        return;
      }
      res.setHeader('Content-Type', 'image/webp');
      res.setHeader('Cache-Control', 'public, max-age=31536000');
      res.writeHead(200);
      res.end(data);
    });
  } catch (error) {
    console.error('提供默认头像时出错:', error.message);
    res.writeHead(500);
    res.end('Internal Server Error');
  }
};

// 提供HTML页面
WebServer.prototype.serveHtmlPage = function(res) {
  res.setHeader('Content-Type', 'text/html');
  res.writeHead(200);
  
  var htmlContent = this.getHtmlContent();
  res.end(htmlContent);
};

// 生成HTML内容
WebServer.prototype.getHtmlContent = function() {
  var html = '';
  html += '<!DOCTYPE html>';
  html += '<html lang="zh-CN">';
  html += '<head>';
  html += '<meta charset="UTF-8">';
  html += '<meta name="viewport" content="width=device-width, initial-scale=1.0">';
  html += '<title>X-Downloader 管理界面</title>';
  html += '<style>';
  html += 'body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; margin: 0; padding: 0; background-color: #f5f5f7; color: #1d1d1f; }';
  html += '.container { max-width: 1000px; margin: 0 auto; padding: 20px; }';
  html += 'header { text-align: center; margin-bottom: 30px; }';
  html += 'h1 { font-size: 32px; font-weight: 600; }';
  html += '.card { background-color: white; border-radius: 12px; padding: 24px; margin-bottom: 20px; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08); }';
  html += '.card h2 { margin-top: 0; font-size: 24px; font-weight: 600; border-bottom: 1px solid #e5e5ea; padding-bottom: 12px; margin-bottom: 20px; }';
  html += '.form-group { margin-bottom: 16px; }';
  html += '.form-input { width: 100%; padding: 12px; font-size: 16px; border: 1px solid #d2d2d7; border-radius: 8px; box-sizing: border-box; }';
  html += '.btn { padding: 12px 24px; font-size: 16px; border: none; border-radius: 8px; cursor: pointer; font-weight: 500; transition: background-color 0.2s; }';
  html += '.btn-primary { background-color: #0071e3; color: white; }';
  html += '.btn-primary:hover { background-color: #0063cc; }';
  html += '.btn-danger { background-color: #ff3b30; color: white; }';
  html += '.btn-danger:hover { background-color: #d70015; }';
  html += '.btn-success { background-color: #34c759; color: white; }';
  html += '.btn-success:hover { background-color: #28a745; }';
  html += '.user-list { list-style: none; padding: 0; }';
  html += '.user-item { display: flex; justify-content: space-between; align-items: center; padding: 16px; border: 1px solid #e5e5ea; border-radius: 8px; margin-bottom: 12px; }';
  html += '.user-info { display: flex; align-items: center; gap: 12px; }';
  html += '.user-avatar { width: 48px; height: 48px; min-width: 48px; min-height: 48px; border-radius: 50%; object-fit: cover; background-image: url("/avatar_default.webp"); background-size: cover; background-position: center; background-repeat: no-repeat; display: block; }';
  html += '.user-avatar.loading { opacity: 0.6; }';
  html += '.user-details { display: flex; flex-direction: column; gap: 4px; }';
  html += '.user-name { font-weight: 600; font-size: 16px; color: #1d1d1f; }';
  html += '.user-username { font-size: 14px; color: #6e6e73; }';
  html += '.user-link { color: #0071e3; text-decoration: none; font-size: 14px; }';
  html += '.user-link:hover { text-decoration: underline; }';
  html += '.user-actions { display: flex; gap: 8px; }';
  html += '.stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; }';
  html += '.stat-card { text-align: center; padding: 20px; background-color: #f8f8f8; border-radius: 8px; }';
  html += '.stat-number { font-size: 36px; font-weight: 700; color: #0071e3; }';
  html += '.stat-label { font-size: 14px; color: #6e6e73; margin-top: 8px; }';
  html += '#notification { position: fixed; bottom: 20px; right: 20px; padding: 16px 24px; border-radius: 8px; color: white; font-weight: 500; opacity: 0; transition: opacity 0.3s; z-index: 1000; }';
  html += '#notification.success { background-color: #34c759; }';
  html += '#notification.error { background-color: #ff3b30; }';
  html += '#notification.show { opacity: 1; }';
  html += '.modal { display: none; position: fixed; z-index: 2000; left: 0; top: 0; width: 100%; height: 100%; background-color: rgba(0, 0, 0, 0.5); }';
  html += '.modal.show { display: flex; align-items: center; justify-content: center; }';
  html += '.modal-content { background-color: white; border-radius: 12px; padding: 24px; max-width: 500px; width: 90%; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2); }';
  html += '.modal-header { display: flex; align-items: center; gap: 16px; margin-bottom: 20px; padding-bottom: 16px; border-bottom: 1px solid #e5e5ea; }';
  html += '.modal-avatar { width: 64px; height: 64px; border-radius: 50%; object-fit: cover; background-image: url("/avatar_default.webp"); background-size: cover; background-position: center; }';
  html += '.modal-user-info { flex: 1; }';
  html += '.modal-user-name { font-size: 20px; font-weight: 600; color: #1d1d1f; margin-bottom: 4px; }';
  html += '.modal-user-username { font-size: 16px; color: #6e6e73; }';
  html += '.modal-body { margin-bottom: 24px; }';
  html += '.modal-actions { display: flex; gap: 12px; justify-content: flex-end; }';
  html += '.btn-cancel { background-color: #f5f5f7; color: #1d1d1f; }';
  html += '.btn-cancel:hover { background-color: #e5e5ea; }';
  html += '.loading-spinner { display: inline-block; width: 16px; height: 16px; border: 2px solid #f3f3f3; border-top: 2px solid #0071e3; border-radius: 50%; animation: spin 1s linear infinite; }';
  html += '@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }';
  html += '</style>';
  html += '</head>';
  html += '<body>';
  html += '<div class="container">';
  html += '<header>';
  html += '<h1>X-Downloader 管理界面</h1>';
  html += '</header>';
  html += '<div class="card">';
  html += '<h2>添加用户</h2>';
  html += '<div class="form-group">';
  html += '<input type="text" id="usernameInput" class="form-input" placeholder="输入Twitter用户名">';
  html += '</div>';
  html += '<button id="addUserBtn" class="btn btn-primary">添加用户</button>';
  html += '</div>';
  html += '<div class="card">';
  html += '<h2>用户列表</h2>';
  html += '<ul id="userList" class="user-list"></ul>';
  html += '</div>';
  html += '<div class="card">';
  html += '<h2>系统统计</h2>';
  html += '<div class="stats-grid">';
  html += '<div class="stat-card">';
  html += '<div id="totalUsers" class="stat-number">0</div>';
  html += '<div class="stat-label">总用户数</div>';
  html += '</div>';
  html += '<div class="stat-card">';
  html += '<div id="monitorInterval" class="stat-number">0</div>';
  html += '<div class="stat-label">监控间隔(分钟)</div>';
  html += '</div>';
  html += '</div>';
  html += '</div>';
  html += '</div>';
  html += '<div id="notification"></div>';
  html += '<div id="addUserModal" class="modal">';
  html += '<div class="modal-content">';
  html += '<div class="modal-header">';
  html += '<img id="modalAvatar" class="modal-avatar" src="/avatar_default.webp" alt="">';
  html += '<div class="modal-user-info">';
  html += '<div id="modalUserName" class="modal-user-name"></div>';
  html += '<div id="modalUserUsername" class="modal-user-username"></div>';
  html += '</div>';
  html += '</div>';
  html += '<div class="modal-body">';
  html += '<p>确认要添加此用户到监控列表吗？</p>';
  html += '</div>';
  html += '<div class="modal-actions">';
  html += '<button id="modalCancelBtn" class="btn btn-cancel">取消</button>';
  html += '<button id="modalConfirmBtn" class="btn btn-primary">确认添加</button>';
  html += '</div>';
  html += '</div>';
  html += '</div>';
  html += '<script>';
  html += 'function showNotification(message, type) {';
  html += '  var notification = document.getElementById("notification");';
  html += '  notification.textContent = message;';
  html += '  notification.className = type + " show";';
  html += '  setTimeout(function() {';
  html += '    notification.className = "";';
  html += '  }, 3000);';
  html += '}';
  html += 'function loadUsers() {';
  html += '  var xhr = new XMLHttpRequest();';
  html += '  xhr.open("GET", "/api/users", true);';
  html += '  xhr.onreadystatechange = function() {';
  html += '    if (xhr.readyState === 4 && xhr.status === 200) {';
  html += '      var data = JSON.parse(xhr.responseText);';
  html += '      renderUserList(data.users);';
  html += '      updateStats();';
  html += '    }';
  html += '  };';
  html += '  xhr.send();';
  html += '}';
  html += 'var userDetailsCache = {};';
  html += 'function fetchUserDetails(username, callback) {';
  html += '  if (userDetailsCache[username]) {';
  html += '    callback(userDetailsCache[username]);';
  html += '    return;';
  html += '  }';
  html += '  var xhr = new XMLHttpRequest();';
  html += '  xhr.open("GET", "/api/users/details?username=" + encodeURIComponent(username), true);';
  html += '  xhr.onreadystatechange = function() {';
  html += '    if (xhr.readyState === 4 && xhr.status === 200) {';
  html += '      try {';
  html += '        var data = JSON.parse(xhr.responseText);';
  html += '        if (data.success && data.user) {';
  html += '          userDetailsCache[username] = data.user;';
  html += '          callback(data.user);';
  html += '        } else {';
  html += '          callback({ username: username, name: username, avatar: "", profileUrl: "https://twitter.com/" + username });';
  html += '        }';
  html += '      } catch (e) {';
  html += '        callback({ username: username, name: username, avatar: "", profileUrl: "https://twitter.com/" + username });';
  html += '      }';
  html += '    } else if (xhr.readyState === 4) {';
  html += '      callback({ username: username, name: username, avatar: "", profileUrl: "https://twitter.com/" + username });';
  html += '    }';
  html += '  };';
  html += '  xhr.send();';
  html += '}';
  html += 'function renderUserList(users) {';
  html += '  var userList = document.getElementById("userList");';
  html += '  userList.innerHTML = "";';
  html += '  for (var i = 0; i < users.length; i++) {';
  html += '    (function() {';
  html += '      var username = users[i];';
  html += '      var li = document.createElement("li");';
  html += '      li.className = "user-item";';
  html += '      var userInfo = document.createElement("div");';
  html += '      userInfo.className = "user-info";';
  html += '      var avatarImg = document.createElement("img");';
  html += '      avatarImg.className = "user-avatar loading";';
  html += '      avatarImg.alt = username;';
  html += '      avatarImg.src = "/avatar_default.webp";';
  html += '      avatarImg.onload = function() { this.classList.remove("loading"); };';
  html += '      avatarImg.onerror = function() { this.src = "/avatar_default.webp"; this.classList.remove("loading"); };';
  html += '      var userDetails = document.createElement("div");';
  html += '      userDetails.className = "user-details";';
  html += '      var userName = document.createElement("div");';
  html += '      userName.className = "user-name";';
  html += '      userName.textContent = "@" + username;';
  html += '      var userUsername = document.createElement("div");';
  html += '      userUsername.className = "user-username";';
  html += '      userUsername.textContent = "@" + username;';
  html += '      var userLink = document.createElement("a");';
  html += '      userLink.className = "user-link";';
  html += '      userLink.href = "https://twitter.com/" + username;';
  html += '      userLink.target = "_blank";';
  html += '      userLink.textContent = "查看主页";';
  html += '      userDetails.appendChild(userName);';
  html += '      userDetails.appendChild(userUsername);';
  html += '      userDetails.appendChild(userLink);';
  html += '      userInfo.appendChild(avatarImg);';
  html += '      userInfo.appendChild(userDetails);';
  html += '      var userActions = document.createElement("div");';
  html += '      userActions.className = "user-actions";';
  html += '      var refreshBtn = document.createElement("button");';
  html += '      refreshBtn.className = "btn btn-primary";';
  html += '      refreshBtn.textContent = "刷新";';
  html += '      refreshBtn.style.fontSize = "14px";';
  html += '      refreshBtn.style.padding = "8px 16px";';
  html += '      refreshBtn.onclick = function(name, img, nameEl, linkEl) {';
  html += '        return function() {';
  html += '          refreshUserDetails(name, img, nameEl, linkEl);';
  html += '        };';
  html += '      }(username, avatarImg, userName, userLink);';
  html += '      var retryBtn = document.createElement("button");';
  html += '      retryBtn.className = "btn btn-success";';
  html += '      retryBtn.textContent = "重试下载";';
  html += '      retryBtn.onclick = function(name) {';
  html += '        return function() {';
  html += '          retryUser(name);';
  html += '        };';
  html += '      }(username);';
  html += '      var deleteBtn = document.createElement("button");';
  html += '      deleteBtn.className = "btn btn-danger";';
  html += '      deleteBtn.textContent = "删除";';
  html += '      deleteBtn.onclick = function(name) {';
  html += '        return function() {';
  html += '          deleteUser(name);';
  html += '        };';
  html += '      }(username);';
  html += '      userActions.appendChild(refreshBtn);';
  html += '      userActions.appendChild(retryBtn);';
  html += '      userActions.appendChild(deleteBtn);';
  html += '      li.appendChild(userInfo);';
  html += '      li.appendChild(userActions);';
  html += '      userList.appendChild(li);';
  html += '      fetchUserDetails(username, function(userData) {';
  html += '        if (userData.avatar) {';
  html += '          avatarImg.onerror = function() { this.src = "/avatar_default.webp"; this.classList.remove("loading"); };';
  html += '          avatarImg.src = userData.avatar;';
  html += '        } else {';
  html += '          avatarImg.src = "/avatar_default.webp";';
  html += '        }';
  html += '        userName.textContent = userData.name || "@" + username;';
  html += '        userUsername.textContent = "@" + username;';
  html += '        userLink.href = userData.profileUrl || "https://twitter.com/" + username;';
  html += '      });';
  html += '    })();';
  html += '  }';
  html += '}';
  html += 'function refreshUserDetails(username, avatarImg, userName, userLink) {';
  html += '  delete userDetailsCache[username];';
  html += '  avatarImg.classList.add("loading");';
  html += '  var xhr = new XMLHttpRequest();';
  html += '  xhr.open("POST", "/api/users/refresh", true);';
  html += '  xhr.setRequestHeader("Content-Type", "application/json");';
  html += '  xhr.onreadystatechange = function() {';
  html += '    if (xhr.readyState === 4 && xhr.status === 200) {';
  html += '      try {';
  html += '        var data = JSON.parse(xhr.responseText);';
  html += '        if (data.success && data.user) {';
  html += '          userDetailsCache[username] = data.user;';
  html += '          if (data.user.avatar) {';
  html += '            avatarImg.onerror = function() { this.src = "/avatar_default.webp"; this.classList.remove("loading"); };';
  html += '            avatarImg.src = data.user.avatar;';
  html += '          } else {';
  html += '            avatarImg.src = "/avatar_default.webp";';
  html += '            avatarImg.classList.remove("loading");';
  html += '          }';
  html += '          userName.textContent = data.user.name || "@" + username;';
  html += '          userLink.href = data.user.profileUrl || "https://twitter.com/" + username;';
  html += '          avatarImg.classList.remove("loading");';
  html += '          showNotification("用户信息已更新", "success");';
  html += '        } else {';
  html += '          avatarImg.classList.remove("loading");';
  html += '          showNotification("刷新失败", "error");';
  html += '        }';
  html += '      } catch (e) {';
  html += '        avatarImg.classList.remove("loading");';
  html += '        showNotification("刷新失败", "error");';
  html += '      }';
  html += '    } else if (xhr.readyState === 4) {';
  html += '      avatarImg.classList.remove("loading");';
  html += '      try {';
  html += '        var data = JSON.parse(xhr.responseText);';
  html += '        showNotification(data.error || "刷新失败", "error");';
  html += '      } catch (e) {';
  html += '        showNotification("刷新失败", "error");';
  html += '      }';
  html += '    }';
  html += '  };';
  html += '  xhr.send(JSON.stringify({ username: username }));';
  html += '}';
  html += 'var pendingAddUser = null;';
  html += 'function addUser() {';
  html += '  var username = document.getElementById("usernameInput").value.trim();';
  html += '  if (!username) {';
  html += '    showNotification("用户名不能为空", "error");';
  html += '    return;';
  html += '  }';
  html += '  var confirmBtn = document.getElementById("modalConfirmBtn");';
  html += '  var originalText = confirmBtn.textContent;';
  html += '  confirmBtn.innerHTML = "<span class=\'loading-spinner\'></span> 验证中...";';
  html += '  confirmBtn.disabled = true;';
  html += '  var modal = document.getElementById("addUserModal");';
  html += '  modal.classList.add("show");';
  html += '  document.getElementById("modalUserName").textContent = "验证中...";';
  html += '  document.getElementById("modalUserUsername").textContent = "@" + username;';
  html += '  document.getElementById("modalAvatar").src = "/avatar_default.webp";';
  html += '  var xhr = new XMLHttpRequest();';
  html += '  xhr.open("GET", "/api/users/details?username=" + encodeURIComponent(username), true);';
  html += '  xhr.onreadystatechange = function() {';
  html += '    if (xhr.readyState === 4) {';
  html += '      confirmBtn.textContent = originalText;';
  html += '      confirmBtn.disabled = false;';
  html += '      if (xhr.status === 200) {';
  html += '        try {';
  html += '          var data = JSON.parse(xhr.responseText);';
  html += '          if (data.success && data.user) {';
  html += '            pendingAddUser = username;';
  html += '            document.getElementById("modalUserName").textContent = data.user.name || "@" + username;';
  html += '            document.getElementById("modalUserUsername").textContent = "@" + username;';
  html += '            if (data.user.avatar) {';
  html += '              var modalAvatar = document.getElementById("modalAvatar");';
  html += '              modalAvatar.onerror = function() { this.src = "/avatar_default.webp"; };';
  html += '              modalAvatar.src = data.user.avatar;';
  html += '            } else {';
  html += '              document.getElementById("modalAvatar").src = "/avatar_default.webp";';
  html += '            }';
  html += '          } else {';
  html += '            showNotification("用户不存在或无法获取信息", "error");';
  html += '            modal.classList.remove("show");';
  html += '          }';
  html += '        } catch (e) {';
  html += '          showNotification("解析用户信息失败", "error");';
  html += '          modal.classList.remove("show");';
  html += '        }';
  html += '      } else {';
  html += '        try {';
  html += '          var data = JSON.parse(xhr.responseText);';
  html += '          showNotification(data.error || "验证用户失败", "error");';
  html += '        } catch (e) {';
  html += '          showNotification("验证用户失败", "error");';
  html += '        }';
  html += '        modal.classList.remove("show");';
  html += '      }';
  html += '    }';
  html += '  };';
  html += '  xhr.send();';
  html += '}';
  html += 'function confirmAddUser() {';
  html += '  if (!pendingAddUser) {';
  html += '    return;';
  html += '  }';
  html += '  var username = pendingAddUser;';
  html += '  var confirmBtn = document.getElementById("modalConfirmBtn");';
  html += '  var originalText = confirmBtn.textContent;';
  html += '  confirmBtn.innerHTML = "<span class=\'loading-spinner\'></span> 添加中...";';
  html += '  confirmBtn.disabled = true;';
  html += '  var xhr = new XMLHttpRequest();';
  html += '  xhr.open("POST", "/api/users", true);';
  html += '  xhr.setRequestHeader("Content-Type", "application/json");';
  html += '  xhr.onreadystatechange = function() {';
  html += '    if (xhr.readyState === 4) {';
  html += '      confirmBtn.textContent = originalText;';
  html += '      confirmBtn.disabled = false;';
  html += '      var modal = document.getElementById("addUserModal");';
  html += '      if (xhr.status === 200) {';
  html += '        try {';
  html += '          var data = JSON.parse(xhr.responseText);';
  html += '          renderUserList(data.users);';
  html += '          updateStats();';
  html += '          document.getElementById("usernameInput").value = "";';
  html += '          showNotification("用户添加成功", "success");';
  html += '          modal.classList.remove("show");';
  html += '          pendingAddUser = null;';
  html += '        } catch (e) {';
  html += '          showNotification("添加失败", "error");';
  html += '        }';
  html += '      } else {';
  html += '        try {';
  html += '          var data = JSON.parse(xhr.responseText);';
  html += '          showNotification(data.error || "添加失败", "error");';
  html += '        } catch (e) {';
  html += '          showNotification("添加失败", "error");';
  html += '        }';
  html += '      }';
  html += '    }';
  html += '  };';
  html += '  xhr.send(JSON.stringify({ username: username }));';
  html += '}';
  html += 'function cancelAddUser() {';
  html += '  var modal = document.getElementById("addUserModal");';
  html += '  modal.classList.remove("show");';
  html += '  pendingAddUser = null;';
  html += '}';
  html += 'function deleteUser(username) {';
  html += '  if (!confirm("确定要删除用户 @" + username + " 吗？")) {';
  html += '    return;';
  html += '  }';
  html += '  var xhr = new XMLHttpRequest();';
  html += '  xhr.open("DELETE", "/api/users/" + username, true);';
  html += '  xhr.onreadystatechange = function() {';
  html += '    if (xhr.readyState === 4) {';
  html += '      if (xhr.status === 200) {';
  html += '        var data = JSON.parse(xhr.responseText);';
  html += '        renderUserList(data.users);';
  html += '        updateStats();';
  html += '        showNotification("用户删除成功", "success");';
  html += '      } else {';
  html += '        try {';
  html += '          var data = JSON.parse(xhr.responseText);';
  html += '          showNotification(data.error || "删除失败", "error");';
  html += '        } catch (e) {';
  html += '          showNotification("删除失败", "error");';
  html += '        }';
  html += '      }';
  html += '    }';
  html += '  };';
  html += '  xhr.send();';
  html += '}';
  html += 'function retryUser(username) {';
  html += '  var xhr = new XMLHttpRequest();';
  html += '  xhr.open("POST", "/api/retry", true);';
  html += '  xhr.setRequestHeader("Content-Type", "application/json");';
  html += '  xhr.onreadystatechange = function() {';
  html += '    if (xhr.readyState === 4) {';
  html += '      if (xhr.status === 200) {';
  html += '        showNotification("已开始重试失败的下载", "success");';
  html += '      } else {';
  html += '        try {';
  html += '          var data = JSON.parse(xhr.responseText);';
  html += '          showNotification(data.error || "重试失败", "error");';
  html += '        } catch (e) {';
  html += '          showNotification("重试失败", "error");';
  html += '        }';
  html += '      }';
  html += '    }';
  html += '  };';
  html += '  xhr.send(JSON.stringify({ username: username }));';
  html += '}';
  html += 'function updateStats() {';
  html += '  var xhr = new XMLHttpRequest();';
  html += '  xhr.open("GET", "/api/stats", true);';
  html += '  xhr.onreadystatechange = function() {';
  html += '    if (xhr.readyState === 4 && xhr.status === 200) {';
  html += '      try {';
  html += '        var data = JSON.parse(xhr.responseText);';
  html += '        document.getElementById("totalUsers").textContent = data.totalUsers || 0;';
  html += '        document.getElementById("monitorInterval").textContent = data.monitorInterval || 0;';
  html += '      } catch (e) {';
  html += '        console.error("解析统计数据失败", e);';
  html += '      }';
  html += '    }';
  html += '  };';
  html += '  xhr.send();';
  html += '}';
  html += 'document.addEventListener("DOMContentLoaded", function() {';
  html += '  document.getElementById("addUserBtn").onclick = addUser;';
  html += '  document.getElementById("modalConfirmBtn").onclick = confirmAddUser;';
  html += '  document.getElementById("modalCancelBtn").onclick = cancelAddUser;';
  html += '  document.getElementById("addUserModal").onclick = function(event) {';
  html += '    if (event.target.id === "addUserModal") {';
  html += '      cancelAddUser();';
  html += '    }';
  html += '  };';
  html += '  document.getElementById("usernameInput").addEventListener("keyup", function(event) {';
  html += '    if (event.keyCode === 13) {';
  html += '      addUser();';
  html += '    }';
  html += '  });';
  html += '  loadUsers();';
  html += '  setInterval(loadUsers, 60000);';
  html += '});';
  html += '</script>';
  html += '</body>';
  html += '</html>';
  return html;
};

module.exports = WebServer;