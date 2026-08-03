// merge-trades.mjs — 合并多页成交明细并生成回访清单（自包含版，支持 STORE_OPS_ROOT）
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── 可移植路径解析（与 parse-data-v2.mjs 一致）───
const WORK_ROOT = process.env.STORE_OPS_ROOT
  ? path.resolve(process.env.STORE_OPS_ROOT)
  : path.resolve(__dirname, '..');

const dataDir = path.join(WORK_ROOT, 'deploy', 'data');

// 导出为可复用函数，供 parse-data-v2.mjs 集成调用
export function runMergeTrades() {

// Load all pages：优先 <WORK_ROOT>/raw，回退到系统 TEMP（兼容旧布局）
const tmpDir = process.env.STORE_OPS_ROOT
  ? path.join(WORK_ROOT, 'raw')
  : (process.env.TEMP || '/tmp');
const pageFiles = [
  path.join(tmpDir, 'trade_detail_raw.json'),
  path.join(tmpDir, 'trade_p2.json'),
  path.join(tmpDir, 'trade_p3.json'),
  path.join(tmpDir, 'trade_p4.json'),
  path.join(tmpDir, 'trade_p5.json'),
  path.join(tmpDir, 'trade_p6.json'),
  path.join(tmpDir, 'trade_p9.json'),
  path.join(tmpDir, 'trade_p11.json'),
];

let allRows = [];
// Get fields from first successful load
let fields = [];
for (const f of pageFiles) {
  try {
    const d = JSON.parse(fs.readFileSync(f, 'utf-8'));
    if (d.data?.data?.length) {
      allRows.push(...d.data.data);
      if (!fields.length) fields = d.data.fields;
    }
  } catch (e) {
    console.log(`  skip ${path.basename(f)}: ${e.message}`);
  }
}

console.log(`Total rows: ${allRows.length}`);
  if (allRows.length === 0) {
    console.log('⚠️ 未找到成交明细临时文件（/tmp/trade_*.json），跳过回访清单生成，保留既有 followUp 数据');
    return;
  }

// ─── Helpers ───
function ev(field) {
  if (field === null || field === undefined) return null;
  if (Array.isArray(field)) return field.map(f => (typeof f === 'object' ? (f.text || f.name || '') : String(f))).filter(Boolean).join(', ');
  if (typeof field === 'object') return field.text || field.name || field.id || null;
  return field;
}

function val(row, map, name) {
  const idx = map[name];
  if (idx === undefined) return null;
  return row[idx];
}

function num(row, map, name) {
  const v = ev(val(row, map, name));
  if (v === null || v === undefined || v === '') return 0;
  return Number(v) || 0;
}

function feishuDateToObj(serial) {
  if (!serial || typeof serial !== 'number') return null;
  const excelEpoch = new Date(Date.UTC(1899, 11, 30));
  const d = new Date(excelEpoch.getTime() + serial * 86400000);
  return d;
}

function dateStr(serial) {
  const d = feishuDateToObj(serial);
  if (!d) return '';
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
}

function daysBetween(s1, s2) {
  if (!s1 || !s2) return null;
  return Math.abs(s1 - s2);
}

function daysAgo(serial, todaySerial) {
  if (!serial || !todaySerial) return null;
  return todaySerial - serial;
}

// Field index map
const fm = {};
fields.forEach((f, i) => { fm[f] = i; });

// ─── Parse trade records ───
const todaySerial = 46226; // 2026-07-23

// Use phone as dedup key, keep record with latest purchase date
const tradeMap = new Map();
for (const row of allRows) {
  const phone = ev(val(row, fm, '客户手机'));
  const clerk = ev(val(row, fm, '标准店员名字'));
  if (!clerk || !phone) continue;
  
  const key = clerk + '::' + phone;
  const latestBuy = num(row, fm, '最新购买日期');
  
  if (tradeMap.has(key)) {
    if (latestBuy > tradeMap.get(key).latestBuySerial) {
      tradeMap.set(key, {
        phone, clerk,
        store: ev(val(row, fm, '门店')),
        latestBuySerial: latestBuy,
        latestBuyDate: dateStr(latestBuy),
        repurchase: ev(val(row, fm, '本月复购分类')),
        userClass: ev(val(row, fm, '本月用户分类')),
        orderCount: num(row, fm, '截止本月下单次数'),
        days30: num(row, fm, '30天内'),
        days60: num(row, fm, '30-60天内'),
        days90F: num(row, fm, '60-90天内'),
        days90: num(row, fm, '90天前购买'),
      });
    }
  } else {
    tradeMap.set(key, {
      phone, clerk,
      store: ev(val(row, fm, '门店')),
      latestBuySerial: latestBuy,
      latestBuyDate: dateStr(latestBuy),
      repurchase: ev(val(row, fm, '本月复购分类')),
      userClass: ev(val(row, fm, '本月用户分类')),
      orderCount: num(row, fm, '截止本月下单次数'),
      days30: num(row, fm, '30天内'),
      days60: num(row, fm, '30-60天内'),
      days90F: num(row, fm, '60-90天内'),
      days90: num(row, fm, '90天前购买'),
    });
  }
}

const trades = [];
for (const t of tradeMap.values()) {
  const daysSince = daysAgo(t.latestBuySerial, todaySerial);

  // Determine repurchase cycle
  let cycle = null;
  if (t.days30 > 0) cycle = 28;
  else if (t.days60 > 0) cycle = 45;
  else if (t.days90F > 0) cycle = 75;
  else if (t.days90 > 0) cycle = 100;

  // Predict next purchase date
  let nextDate = null;
  if (daysSince !== null) {
    if (daysSince > 90) {
      // Very old purchase - don't predict, just flag
      nextDate = '尽快联系';
    } else if (cycle && daysSince < cycle) {
      const daysUntil = cycle - daysSince;
      nextDate = dateStr(todaySerial + daysUntil);
    } else {
      // Default 30-day cycle
      const daysUntil = Math.max(0, 30 - daysSince);
      nextDate = daysUntil <= 0 ? '已到期，立即联系' : dateStr(todaySerial + daysUntil);
    }
  }

  // Urgency classification
  let urgency = null;
  if (daysSince !== null) {
    if (daysSince > 90) urgency = 'lost';      // 流失
    else if (daysSince > 60) urgency = 'critical';  // 高危
    else if (daysSince > 30) urgency = 'high';      // 紧急
    else if (daysSince > 14) urgency = 'medium';    // 本周
  }

  trades.push({
    phone: t.phone,
    clerk: t.clerk,
    store: t.store,
    latestBuyDate: t.latestBuyDate,
    daysSince,
    repurchase: t.repurchase,
    userClass: t.userClass,
    orderCount: t.orderCount,
    cycle: cycle || 30,
    nextPredictedDate: nextDate,
    urgency,
  });
}

console.log(`Parsed ${trades.length} unique customers for ${new Set(trades.map(t => t.clerk)).size} clerks`);

// ─── Group by clerk & generate follow-up list ───
const clerkFollowUps = {};
for (const t of trades) {
  // Skip customers with no follow-up urgency (recent purchases within 7 days)
  if (!t.urgency) continue;
  const clerk = t.clerk;
  if (!clerkFollowUps[clerk]) clerkFollowUps[clerk] = [];
  clerkFollowUps[clerk].push(t);
}

// Sort each clerk's list by urgency (lost→critical→high→medium), then by daysSince (oldest first)
for (const [clerk, items] of Object.entries(clerkFollowUps)) {
  const urgencyScore = { lost: 0, critical: 1, high: 2, medium: 3 };
  items.sort((a, b) => {
    if (urgencyScore[a.urgency] !== urgencyScore[b.urgency])
      return urgencyScore[a.urgency] - urgencyScore[b.urgency];
    return (b.daysSince || 0) - (a.daysSince || 0);
  });
}

// ─── Update user JSONs with follow-up data ───
const userFiles = fs.readdirSync(dataDir).filter(f => f.endsWith('.json') && f !== 'version.json');
const urgencyLabel = { lost: '已流失', critical: '高危', high: '紧急', medium: '本周' };

for (const f of userFiles) {
  const fp = path.join(dataDir, f);
  const u = JSON.parse(fs.readFileSync(fp, 'utf-8'));
  const clerk = u.name;
  const items = clerkFollowUps[clerk] || [];

  const lost = items.filter(t => t.urgency === 'lost').length;
  const critical = items.filter(t => t.urgency === 'critical').length;
  const high = items.filter(t => t.urgency === 'high').length;
  const medium = items.filter(t => t.urgency === 'medium').length;

  // Build full follow-up list (no truncation — counts must match the displayed list)
  const listItems = items.map(t => ({
    phone: t.phone,
    lastBuy: t.latestBuyDate,
    daysAgo: t.daysSince,
    predicted: t.nextPredictedDate,
    cycle: t.cycle,
    urgency: urgencyLabel[t.urgency] || '',
    level: t.urgency,
  }));

  u.followUp = {
    lost, critical, high, medium,
    total: items.length,
    list: listItems
  };
  
  fs.writeFileSync(fp, JSON.stringify(u, null, 2), 'utf-8');
}

console.log(`Updated ${userFiles.length} user JSONs with follow-up data`);

// ─── Summary ───
for (const [clerk, items] of Object.entries(clerkFollowUps)) {
  const lost = items.filter(t => t.urgency === 'lost').length;
  const crit = items.filter(t => t.urgency === 'critical').length;
  const high = items.filter(t => t.urgency === 'high').length;
  const med = items.filter(t => t.urgency === 'medium').length;
  console.log(`  ${clerk}: ${items.length} | ⚫${lost} 🔴${crit} 🟠${high} 🟡${med}`);
}

// ─── Update version.json so browsers auto-refresh ───
const versionFile = path.join(dataDir, 'version.json');
try {
  const versionData = JSON.parse(fs.readFileSync(versionFile, 'utf-8'));
  const now = new Date();
  const ts = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}-${String(now.getMinutes()).padStart(2,'0')}`;
  versionData.version = ts;
  versionData.updatedAt = now.toISOString();
  fs.writeFileSync(versionFile, JSON.stringify(versionData, null, 2), 'utf-8');
  console.log(`Updated version.json to ${ts}`);
} catch (e) {
  console.log('Could not update version.json:', e.message);
}
} // end runMergeTrades

// 独立运行时（node scripts/merge-trades.mjs）自动执行；被其他脚本 import 时不自动跑
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runMergeTrades();
}
