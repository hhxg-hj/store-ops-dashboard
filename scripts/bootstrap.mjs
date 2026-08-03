// bootstrap.mjs — 初始化专家自包含工作区（首次运行或换电脑时执行一次）
// 作用：找到专家包 → 把脚本/HTML模板复制到工作根目录 → 建好 raw/deploy 结构 → 初始化 git。
// 之后所有更新/修改都由专家在该工作区内"直接进行"，不再依赖任何外部项目目录。
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { PKG_DIR, WORK_ROOT, RAW_DIR, DEPLOY_DIR, DATA_DIR, SCRIPTS_DIR, TEMPLATES_DIR, REPO } from './config.mjs';

console.log('🔧 初始化门店运营数据运维专家工作区...\n');
console.log('   专家包目录 :', PKG_DIR);
console.log('   工作根目录 :', WORK_ROOT, '(可用 STORE_OPS_ROOT 覆盖)');

// 1. 创建目录结构
for (const d of [WORK_ROOT, RAW_DIR, DEPLOY_DIR, DATA_DIR, path.join(DEPLOY_DIR, 'assets'), SCRIPTS_DIR]) {
  fs.mkdirSync(d, { recursive: true });
}

// 2. 复制管线脚本到工作区 scripts/（之后在此运行，原始数据放 raw/，产出放 deploy/）
const pkgScripts = path.join(PKG_DIR, 'scripts');
for (const f of fs.readdirSync(pkgScripts).filter(f => f.endsWith('.mjs'))) {
  fs.copyFileSync(path.join(pkgScripts, f), path.join(SCRIPTS_DIR, f));
}

// 3. 复制 HTML 模板到 deploy/index.html
fs.copyFileSync(path.join(TEMPLATES_DIR, 'index.html'), path.join(DEPLOY_DIR, 'index.html'));

// 4. 初始化 git（部署用，远程/凭证由用户或 GitHub 连接器提供）
const gitDir = path.join(DEPLOY_DIR, '.git');
if (!fs.existsSync(gitDir)) {
  try {
    execSync('git init -q', { cwd: DEPLOY_DIR });
    execSync('git config user.name "WorkBuddy"', { cwd: DEPLOY_DIR });
    execSync('git config user.email "workbuddy@example.com"', { cwd: DEPLOY_DIR });
    console.log('\n✅ 已在 deploy/ 初始化 git 仓库');
  } catch (e) {
    console.log('\n⚠️ git 初始化失败（可稍后手动 git init）：', e.message);
  }
}

console.log('\n✅ 工作区就绪。下一步：');
console.log('   1) 拉取飞书数据 :  node scripts/fetch-feishu.mjs');
console.log('   2) 解析生成数据 :  STORE_OPS_ROOT="' + WORK_ROOT + '" node scripts/parse-data-v2.mjs');
console.log('   3) 生成看板 HTML :  STORE_OPS_ROOT="' + WORK_ROOT + '" node scripts/build-index.mjs');
console.log('   4) 部署到 Pages  :  STORE_OPS_ROOT="' + WORK_ROOT + '" STORE_OPS_REPO="' + REPO + '" node scripts/deploy.mjs');
console.log('   5) 企微推送链接 :  node scripts/send-wecom-links-batch.mjs  (需 WECOM_CORPSECRET)');
console.log('\n提示：把 STORE_OPS_ROOT 设为上面的工作根目录即可，专家每次更新都"直接进行"，无需外部脚本。');
