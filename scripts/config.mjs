// config.mjs — 专家包内脚本共享的路径解析（自包含核心）
// 任何脚本 import 本文件即可得到包目录与工作根目录，无需硬编码机器路径。
import path from 'path';
import { fileURLToPath } from 'url';

// 专家包根目录：scripts/ 的上级
export const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 工作根目录（原始数据 + 产出）：
//   • 由环境变量 STORE_OPS_ROOT 显式指定（推荐，分享到其他电脑时用）
//   • 否则默认当前目录下的 store-ops-workspace/
export const WORK_ROOT = process.env.STORE_OPS_ROOT
  ? path.resolve(process.env.STORE_OPS_ROOT)
  : path.resolve(process.cwd(), 'store-ops-workspace');

export const RAW_DIR = path.join(WORK_ROOT, 'raw');
export const DEPLOY_DIR = path.join(WORK_ROOT, 'deploy');
export const DATA_DIR = path.join(DEPLOY_DIR, 'data');
export const SCRIPTS_DIR = path.join(WORK_ROOT, 'scripts');
export const TEMPLATES_DIR = path.join(PKG_DIR, 'templates');

// GitHub Pages 仓库（可配置，默认现有线上仓库）
export const REPO = process.env.STORE_OPS_REPO || 'hhxg-hj/store-ops-dashboard';
