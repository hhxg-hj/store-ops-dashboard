// build-index.mjs — 用专家包内的 HTML 模板生成看板 deploy/index.html
// HTML 内容逻辑的"编写/修改"现在由专家直接进行：改 templates/index.html → 跑本脚本重新生成，无需改外部文件。
// 导出 build() 供 deploy.mjs 复用，确保"部署前一定从模板重新生成"，从机制上保证 模板 = 线上。
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { DEPLOY_DIR, TEMPLATES_DIR } from './config.mjs';

export function build() {
  const src = path.join(TEMPLATES_DIR, 'index.html');
  const dst = path.join(DEPLOY_DIR, 'index.html');
  if (!fs.existsSync(src)) {
    console.error('❌ 未找到 HTML 模板：', src);
    process.exit(1);
  }
  fs.mkdirSync(DEPLOY_DIR, { recursive: true });
  fs.copyFileSync(src, dst);
  console.log('✅ 看板 HTML 已生成 →', dst, '（来源：templates/index.html）');
  return dst;
}

// 直接运行时执行（用 pathToFileURL 兼容 Windows 路径格式）
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  build();
  console.log('   修改看板样式/模块时，请编辑 templates/index.html 后重跑本脚本。');
}
