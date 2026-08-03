// deploy.mjs — 部署看板到 GitHub Pages（零硬编码 token 版）
//
// 设计原则（满足"模板与线上一致 + 不依赖本地硬编码 token"）：
//   1) 部署前【强制】重跑 build-index，确保 deploy/index.html 永远由 templates/index.html 生成
//      → 从机制上锁死"模板 = 线上"。
//   2) 推送由 GitHub 连接器完成（鉴权走连接器，任何文件都不写 token）。
//      本脚本是 Node 进程，无法直接调用 MCP，因此负责：重新生成 HTML + 本地提交 + 输出"待推送清单"；
//      真正的推送由专家（agent）调用 mcp__github__push_files 完成。
//   3) 兼容：若运行时设置了 GITHUB_TOKEN / GH_TOKEN 环境变量（来自连接器或用户临时提供，非写死在文件），
//      也可走 git push。
//
// 用法：STORE_OPS_ROOT=<工作根> STORE_OPS_REPO=hhxg-hj/store-ops-dashboard node scripts/deploy.mjs

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { DEPLOY_DIR, DATA_DIR, REPO } from './config.mjs';
import { build } from './build-index.mjs';

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19).replace('T', ' ');

console.log('🚀 准备部署看板到 GitHub Pages:', REPO);

// —— 1) 强制从模板重新生成（保证 模板 = 线上）——
build();

// —— 2) 收集待推送的文本产物（不含二进制资源）——
// 二进制（图片/视频/测试题）通常不常变，且已在 Pages 上，本次不重传以避免体积过大。
const files = [];
const add = (rel) => {
  const full = path.join(DEPLOY_DIR, rel);
  if (fs.existsSync(full)) files.push({ path: rel, content: fs.readFileSync(full, 'utf-8') });
};
add('index.html');
if (fs.existsSync(DATA_DIR)) {
  for (const f of fs.readdirSync(DATA_DIR).filter((x) => x.endsWith('.json'))) {
    add(path.join('data', f));
  }
}
const manifestPath = path.join(DEPLOY_DIR, 'assets/manifest.json');
if (fs.existsSync(manifestPath)) add('assets/manifest.json');

console.log(`   待发布文本文件：${files.length} 个（index.html + data/*.json + manifest）`);

// —— 3) 本地提交（保留历史，不推送）——
if (fs.existsSync(path.join(DEPLOY_DIR, '.git'))) {
  try {
    execSync('git add -A', { cwd: DEPLOY_DIR, stdio: 'pipe' });
    execSync(`git commit -q -m "chore: 更新店员看板 ${ts}"`, { cwd: DEPLOY_DIR, stdio: 'pipe' });
  } catch (_) { /* 无新变更，忽略 */ }
}

// —— 4) 推送：环境变量 token 走 git；否则交给专家用 GitHub 连接器推送（零 token）——
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
if (token) {
  console.log('   检测到 GITHUB_TOKEN，使用 git push（token 来自运行时环境变量，非文件写死）');
  const urlWithToken = `https://${token}@github.com/${REPO}.git`;
  const urlPlain = `https://github.com/${REPO}.git`;
  try {
    execSync(`git remote set-url origin "${urlWithToken}"`, { cwd: DEPLOY_DIR, stdio: 'pipe' });
    execSync('git push -u origin main', { cwd: DEPLOY_DIR, stdio: 'pipe' });
    execSync(`git remote set-url origin "${urlPlain}"`, { cwd: DEPLOY_DIR, stdio: 'pipe' });
    console.log('✅ 已通过 git 推送到', REPO);
  } catch (e) {
    // 还原为无 token 的 remote，避免把 token 留在 .git/config
    try { execSync(`git remote set-url origin "${urlPlain}"`, { cwd: DEPLOY_DIR, stdio: 'pipe' }); } catch (_) {}
    console.error('❌ git 推送失败：', e.stderr || e.message);
    process.exit(1);
  }
} else {
  const [owner, repo] = REPO.split('/');
  console.log('\n✅ 本地产物已就绪。请通过 GitHub 连接器推送（零 token，推荐）：');
  console.log('   调用 mcp__github__push_files：');
  console.log(`     owner="${owner}"  repo="${repo}"  branch="main"`);
  console.log(`     message="chore: 更新店员看板 ${ts}"`);
  console.log('     files=[ index.html + data/*.json + assets/manifest.json ]（读取 DEPLOY_DIR 下同名文件内容）');
  console.log('   提示：二进制资源（图片/视频）已在 Pages 上，无需重复推送；仅当资源变更时才需单独处理。');
  console.log(`🌐 看板地址：https://${owner}.github.io/${repo}/?id=<店员名>`);
}
