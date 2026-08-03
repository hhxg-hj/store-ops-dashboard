// fetch-feishu.mjs — 通过飞书连接器(lark-cli, 用户身份)拉取所有原始数据到 WORK_ROOT/raw
// 依赖：lark-cli 已在 PATH，且飞书连接器已以"用户身份"登录（无需硬编码凭证，换电脑只需重新登录连接器）。
// 用法：STORE_OPS_ROOT=<工作根目录> node scripts/fetch-feishu.mjs
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { RAW_DIR } from './config.mjs';

const LARK = 'lark-cli base +record-list'; // 飞书连接器 CLI（如版本变更子命令，按需调整）
const LIMIT = 200;

// 数据源：Base + 表 → 输出文件名（与 parse-data-v2.mjs 的 load() 一一对应）
// ⚠️ product_kb_raw.json 的来源表未登记，请在此补充其 base/table，或手动放入 raw/。
const TABLES = [
  { base: 'WFrkb7zn1aZV8gsTcrtcAvSZnzh', table: 'tblKTYdxfRmfsnok', out: 'cockpit_raw.json',   name: '观测驾驶舱' },
  { base: 'WFrkb7zn1aZV8gsTcrtcAvSZnzh', table: 'tbl6ZyqaHZc66gCh', out: 'user_service_raw.json', name: '用户维系' },
  { base: 'WFrkb7zn1aZV8gsTcrtcAvSZnzh', table: 'tbl26Xgt7tKfSkOm', out: 'wecom_contact_raw.json', name: '店员企微联系情况' },
  { base: 'WFrkb7zn1aZV8gsTcrtcAvSZnzh', table: 'tbl1ljxwzDcHRB42', out: 'wecom_members_raw.json', name: '企微成员统计' },
  { base: 'WFrkb7zn1aZV8gsTcrtcAvSZnzh', table: 'tblj7Vw6nKzNp4xf', out: 'trade_detail_raw.json', name: '成交明细' },
  // 奶粉销售明细：用于按「主推/儿童/特配/通货」四类拆解每店员销量、占比、毛利率
  { base: 'WFrkb7zn1aZV8gsTcrtcAvSZnzh', table: 'tblBzIWOhqfuClsx', out: 'cloud_sales_raw.json', name: '门店云销售明细' },
  { base: 'WFrkb7zn1aZV8gsTcrtcAvSZnzh', table: 'tbldx4VAqRJzFvkm', out: 'bonded_sales_raw.json', name: '直营保税销售明细' },
  { base: 'KueTbzzWbaGnWHsFJnpcySnGngh', table: 'tblhQBXlP2WgBT24', out: 'incentive_raw.json',  name: '激励考核' },
  { base: 'KueTbzzWbaGnWHsFJnpcySnGngh', table: 'tbloSF8ugi3J7bk4', out: 'staff_master_raw.json', name: '店员主数据' },
  { base: 'KueTbzzWbaGnWHsFJnpcySnGngh', table: 'tblIR7hFrx46e9NW', out: 'baojin_raw.json',    name: '保证金' },
];

function pullOne(t) {
  console.log(`\n📥 ${t.name} (${t.base} / ${t.table}) → ${t.out}`);
  let fields = null;
  let all = [];
  let offset = 0;
  while (true) {
    const cmd = `${LARK} --base-token ${t.base} --table-id ${t.table} --as user --limit ${LIMIT} --offset ${offset} --json`;
    let out;
    try {
      out = execSync(cmd, { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
    } catch (e) {
      console.error(`  ❌ 拉取失败（offset ${offset}）：${e.stderr || e.message}`);
      throw e;
    }
    const json = JSON.parse(out);
    const data = json?.data || json;
    const rows = data?.data || [];
    if (!fields && data?.fields) fields = data.fields;
    all.push(...rows);
    if (rows.length < LIMIT) break;
    offset += LIMIT;
  }
  const payload = { data: { fields: fields || [], data: all } };
  fs.writeFileSync(path.join(RAW_DIR, t.out), JSON.stringify(payload, null, 2), 'utf-8');
  console.log(`  ✅ ${all.length} 行 → ${t.out}`);
}

fs.mkdirSync(RAW_DIR, { recursive: true });
for (const t of TABLES) pullOne(t);

// product_kb 未登记来源：检查是否已存在，否则告警
const kbPath = path.join(RAW_DIR, 'product_kb_raw.json');
if (!fs.existsSync(kbPath)) {
  console.log('\n⚠️ product_kb_raw.json 缺失：请补充其飞书表到本脚本 TABLES，或手动放入 raw/ 后重跑 parse。');
}

console.log('\n✅ 飞书原始数据拉取完成（如某表失败，按上面错误修正 lark-cli 子命令或权限后重跑）。');
