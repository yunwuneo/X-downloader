#!/usr/bin/env node
const fs = require('fs-extra');
const path = require('path');
const { program } = require('commander');

// 用户列表文件路径
const USERS_FILE = './users.json';

// 确保用户列表文件存在
async function ensureUsersFile() {
  if (!await fs.pathExists(USERS_FILE)) {
    await fs.writeJson(USERS_FILE, {
      users: [],
      updatedAt: new Date().toISOString()
    }, { spaces: 2 });
  }
}

// 读取用户列表
async function getUsers() {
  await ensureUsersFile();
  const data = await fs.readJson(USERS_FILE);
  return data.users || [];
}

// 保存用户列表
async function saveUsers(users) {
  await fs.writeJson(USERS_FILE, {
    users: users,
    updatedAt: new Date().toISOString()
  }, { spaces: 2 });
}

// 添加用户
async function addUser(username) {
  if (!username || typeof username !== 'string' || username.trim() === '') {
    console.error('错误: 用户名不能为空');
    return false;
  }
  
  const users = await getUsers();
  const normalizedUsername = username.trim().toLowerCase();
  
  if (users.includes(normalizedUsername)) {
    console.log(`用户 ${normalizedUsername} 已存在`);
    return false;
  }
  
  users.push(normalizedUsername);
  await saveUsers(users);
  console.log(`已添加用户: ${normalizedUsername}`);
  return true;
}

// 删除用户
async function removeUser(username) {
  if (!username) {
    console.error('错误: 用户名不能为空');
    return false;
  }
  
  const users = await getUsers();
  const normalizedUsername = username.trim().toLowerCase();
  
  if (!users.includes(normalizedUsername)) {
    console.log(`用户 ${normalizedUsername} 不存在`);
    return false;
  }
  
  const newUsers = users.filter(user => user !== normalizedUsername);
  await saveUsers(newUsers);
  console.log(`已删除用户: ${normalizedUsername}`);
  return true;
}

// 列出所有用户
async function listUsers() {
  const users = await getUsers();
  
  if (users.length === 0) {
    console.log('当前没有监控任何用户');
    return;
  }
  
  console.log('当前监控的用户:');
  users.forEach((user, index) => {
    console.log(`${index + 1}. ${user}`);
  });
}

// 清空用户列表
async function clearUsers() {
  await saveUsers([]);
  console.log('已清空所有用户');
}

// 主程序
program
  .name('x-downloader')
  .description('X-Downloader命令行工具 - 管理监控用户列表')
  .version('1.0.0');

// 添加用户命令
program
  .command('add <username>')
  .description('添加要监控的用户')
  .action(addUser);

// 删除用户命令
program
  .command('remove <username>')
  .description('删除要监控的用户')
  .action(removeUser);

// 列出用户命令
program
  .command('list')
  .description('列出所有要监控的用户')
  .action(listUsers);

// 清空用户命令
program
  .command('clear')
  .description('清空所有用户')
  .action(clearUsers);

// 解析命令行参数
program.parse(process.argv);

// 如果没有提供命令，显示帮助信息
if (!process.argv.slice(2).length) {
  program.outputHelp();
  console.log('\n示例:');
  console.log('  node cli.js add elonmusk      # 添加用户elonmusk');
  console.log('  node cli.js remove twitter    # 删除用户twitter');
  console.log('  node cli.js list              # 列出所有用户');
  console.log('  node cli.js clear             # 清空所有用户');
}