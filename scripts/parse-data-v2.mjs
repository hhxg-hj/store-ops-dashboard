// parse-data-v2.mjs — 按LTV快报专家模板解析全部数据源（自包含版，支持 STORE_OPS_ROOT）
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── 可移植路径解析 ───
// WORK_ROOT：原始数据(raw) 与产出(deploy) 的根目录。
//   • 默认：脚本所在目录的上级（兼容"scripts/ 放 raw、deploy/ 在同级"的经典布局）
//   • 自包含模式：由专家 bootstrap 设定 STORE_OPS_ROOT，原始数据放 <root>/raw，产出放 <root>/deploy
const WORK_ROOT = process.env.STORE_OPS_ROOT
  ? path.resolve(process.env.STORE_OPS_ROOT)
  : path.resolve(__dirname, '..');

// 原始数据目录：优先 <WORK_ROOT>/raw，不存在则回退到脚本同目录（兼容旧布局）
const RAW_DIR = (() => {
  const r = path.join(WORK_ROOT, 'raw');
  return fs.existsSync(r) ? r : __dirname;
})();

const dataDir = path.join(WORK_ROOT, 'deploy', 'data');

function load(name) {
  return JSON.parse(fs.readFileSync(path.join(RAW_DIR, name), 'utf-8'));
}

// ─── Load raw data ───
const incentive = load('incentive_raw.json');
const cockpit = load('cockpit_raw.json');
const staffMaster = load('staff_master_raw.json');
const userService = load('user_service_raw.json');
const baojin = load('baojin_raw.json');
const productKb = load('product_kb_raw.json');
const wecomContact = load('wecom_contact_raw.json');
// 奶粉销售明细：门店云 + 直营保税，用于按「主推/儿童/特配/通货」四类拆解
const cloudSales = load('cloud_sales_raw.json');
const bondedSales = load('bonded_sales_raw.json');
// 成交明细（用于「一个月内/二至三个月内/三个月以上」客服数）
const tradeDetail = load('trade_detail_raw.json');
// 企微成员统计（企微用户总量、今日新增）——可选，缺文件时降级为不展示
let wecomMembers = { data: { fields: [], data: [] } };
try { wecomMembers = load('wecom_members_raw.json'); } catch (e) { console.log('⚠️ wecom_members_raw.json 缺失，企微用户总量将显示 —'); }

// ─── Build field maps ───
function buildMap(raw) {
  const fields = raw.data.fields;
  const m = {};
  fields.forEach((f, i) => { m[f] = i; });
  return { map: m, rows: raw.data.data || [], fields };
}
const im = buildMap(incentive);
const cm = buildMap(cockpit);
const sm = buildMap(staffMaster);
const um = buildMap(userService);
const bm = buildMap(baojin);
const pm = buildMap(productKb);
const wm = buildMap(wecomContact);
const csm = buildMap(cloudSales);
const bsm = buildMap(bondedSales);
const wmm = buildMap(wecomMembers);

// ─── Parse 企微成员统计：企微用户总量 + 今日新增（按店员）───
const wecomMemberMap = {};
for (const row of wmm.rows) {
  const n = ev(val(row, wmm.map, '【标准】店员名字')) || '';
  if (!n) continue;
  wecomMemberMap[n] = {
    qwTotal: num(row, wmm.map, '客户总数'),
    qwTodayNew: num(row, wmm.map, '今日新增'),
  };
}

// ─── Extract helpers ───
function ev(field) {
  if (field === null || field === undefined) return null;
  if (Array.isArray(field)) return field.map(f => (typeof f === 'object' ? (f.text || f.name || '') : String(f))).filter(Boolean).join(', ');
  if (typeof field === 'object') return field.text || field.name || field.id || null;
  return field;
}
function val(row, map, name) { if (!row) return null; const idx = map[name]; return idx !== undefined ? row[idx] : null; }
function num(row, map, name) { if (!row) return 0; const v = ev(val(row, map, name)); if (v === null || v === undefined || v === '') return 0; return Number(v) || 0; }
function arr(row, map, name) {
  if (!row) return [];
  const v = val(row, map, name);
  if (Array.isArray(v)) return v.map(f => typeof f === 'string' ? f : (f.text || f.name || '')).filter(Boolean);
  return [];
}
function _mom(thisVal, lastVal) {
  if (!lastVal || lastVal === 0) return null;
  return (thisVal - lastVal) / lastVal;
}
function momArrow(pct) {
  if (pct === null) return '—';
  return (pct >= 0 ? '↑' : '↓') + Math.abs(pct * 100).toFixed(1) + '%';
}
// 解析百分比字段：支持 "93%"、"0.93"、"93" → 数值（0-100）。与线上 deploy 版保持一致
function parsePercent(v) {
  if (v === null || v === undefined || v === '') return 0;
  const s = String(v).replace(/%/g, '').replace(/\s/g, '').trim();
  const n = Number(s);
  if (isNaN(n)) return 0;
  return n > 1 ? n : n * 100;
}

// ─── Store → Region ───
const storeRegion = {
  '宝妈时光（大礼堂总店）': '重庆区域',
  '宝妈时光（金沙天街店）': '重庆区域',
  '宝妈时光（重庆綦江万达店）': '重庆区域',
  '宝妈时光（成都光环店）': '成都区域',
};
function getRegion(store) {
  for (const [k, v] of Object.entries(storeRegion)) {
    if ((store || '').includes(k) || k.includes(store || '')) return v;
  }
  return '其他区域';
}

// ─── Parse staff master ───
const staffInfo = {};
for (const row of sm.rows) {
  const n = ev(val(row, sm.map, '【标准】店员名字')) || '';
  if (!n) continue;
  staffInfo[n] = {
    bindWecom: ev(val(row, sm.map, '绑定企微名称')) || '',
    store: arr(row, sm.map, '所属门店').join(', '),
    zaidian: ev(val(row, sm.map, '是否在店')) === '是',
  };
}

// ─── Parse user service ───
const usInfo = {};
for (const row of um.rows) {
  const n = ev(val(row, um.map, '【标准】店员名字')) || ev(val(row, um.map, '店员')) || '';
  if (!n) continue;
  usInfo[n] = {
    totalClients: num(row, um.map, '本月下单客户数'),
    totalClientsLast: num(row, um.map, '上月下单客户数'),
    visitShould: num(row, um.map, '应回访用户量'),
    visitDone: num(row, um.map, '已回访用户量'),
    visitPending: num(row, um.map, '待回访用户量'),
    momClients: num(row, um.map, '成交客户环比'),
    storeName: arr(row, um.map, '门店名称').join(', ') || (staffInfo[n] ? staffInfo[n].store : ''),
    // ── 客服服务指标（来源：用户维系表 tbl6ZyqaHZc66gCh，Base1=WFrkb7zn1aZV8gsTcrtcAvSZnzh）──
    newServiceCount: num(row, um.map, '企微本月添加会员达成'),  // 新增客服数
    chatTotal: num(row, um.map, '当月聊天总数'),              // 聊天总数
    msgSent: num(row, um.map, '发消息数'),                    // 发送消息数
    replyRate: parsePercent(val(row, um.map, '回复聊天占比')), // 已回复占比（0-100）
    firstReplyMin: num(row, um.map, '首次回复时长（分钟）'),  // 平均首响（分钟）
  };
}

// ─── Parse deposit ───
const depositCount = {};
for (const row of bm.rows) {
  const clerk = ev(val(row, bm.map, '店员')) || '';
  if (!clerk) continue;
  depositCount[clerk] = (depositCount[clerk] || 0) + 1;
}

// ─── Parse 店员企微联系情况（仅取用户指标目标 = 当月新增客户数）───
// 取最新月份（当月）每位店员的「新增客户数」作为用户指标目标值
const wecomMap = {};
{
  let latestMonth = '';
  for (const r of wm.rows) {
    const m = ev(val(r, wm.map, '月份')) || '';
    if (m > latestMonth) latestMonth = m;
  }
  for (const r of wm.rows) {
    const m = ev(val(r, wm.map, '月份')) || '';
    if (m !== latestMonth) continue;
    const n = ev(val(r, wm.map, '【标准】店员名字')) || '';
    if (!n) continue;
    wecomMap[n] = { newCustomers: num(r, wm.map, '新增客户数') };
  }
}

// ─── Parse 奶粉销售明细（门店云 + 直营保税）───
// 按「主推/儿童/特配/通货」四类聚合每店员当月的销量、销售额、毛利，并计算毛利率与占比。
// 两类明细表的分类字段、数量字段、金额/毛利字段不同，统一归到同一套结构。
const CATEGORY_KEY = {
  '主推': 'main', '主推奶粉': 'main',
  '通货': 'general', '通货奶粉': 'general',
  '特配': 'special', '特配奶粉': 'special',
  '儿童': 'child', '儿童奶粉': 'child',
};
const CATEGORY_LABEL = {
  main: '主推奶粉', general: '通货奶粉', special: '特配奶粉', child: '儿童奶粉',
};
// 报表月份自动识别：取 incentive 表中最新「年月」（避免硬编码，换月零维护）
// 上月 = 其前一个自然月（日历减一，避免数据缺月导致跨月比较）
function maxYearMonth(rows, map) {
  let max = '';
  for (const r of rows) {
    const m = ev(val(r, map, '年月')) || '';
    if (/^\d{4}-\d{2}$/.test(m) && m > max) max = m;
  }
  return max;
}
const REPORT_MONTH = maxYearMonth(im.rows, im.map);
if (!REPORT_MONTH) {
  console.error('❌ 未能从 incentive_raw 识别报表月份（缺少 年月 字段），请检查数据源');
  process.exit(1);
}
const LAST_MONTH = (() => {
  const [y, mo] = REPORT_MONTH.split('-').map(Number);
  const d = new Date(y, mo - 2, 1); // mo-2 → 上一月（Date 月份为 0-based）
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
})();
console.log(`📅 报表月份自动识别：本月=${REPORT_MONTH}　上月=${LAST_MONTH}`);
function getClerkName(row, map) {
  return ev(val(row, map, '【标准】店员名字')) || ev(val(row, map, '店员名称')) || ev(val(row, map, '店员')) || '';
}
function aggregateMilkSales(mapSpec, monthFilter) {
  const byClerk = {};
  for (const row of mapSpec.rows) {
    const m = ev(val(row, mapSpec.map, '年月')) || '';
    if (monthFilter && m !== monthFilter) continue;
    const clerk = getClerkName(row, mapSpec.map);
    if (!clerk || clerk === '空白') continue;
    const cat = ev(val(row, mapSpec.map, mapSpec.catField)) || '';
    const key = CATEGORY_KEY[String(cat).trim()];
    if (!key) continue; // 只统计四类奶粉
    const qty = num(row, mapSpec.map, mapSpec.qtyField);
    const refund = mapSpec.refundField ? num(row, mapSpec.map, mapSpec.refundField) : 0;
    const netQty = qty - refund;
    const amount = num(row, mapSpec.map, mapSpec.amountField);
    const profit = num(row, mapSpec.map, mapSpec.profitField);
    if (!byClerk[clerk]) byClerk[clerk] = {};
    if (!byClerk[clerk][key]) byClerk[clerk][key] = { qty: 0, amount: 0, profit: 0 };
    byClerk[clerk][key].qty += netQty;
    byClerk[clerk][key].amount += amount;
    byClerk[clerk][key].profit += profit;
  }
  return byClerk;
}
const cloudByClerk = aggregateMilkSales(
  { ...csm, catField: '奶粉品类（细分）', qtyField: '数量', amountField: '销售金额', profitField: '商品毛利' },
  REPORT_MONTH
);
const bondedByClerk = aggregateMilkSales(
  { ...bsm, catField: '奶粉分类（细）', qtyField: '销售/退货数量', refundField: '退款数量', amountField: 'GMV（支付金额）', profitField: '门店收益（不含手续费）' },
  REPORT_MONTH
);
function mergeMilkSales(...sources) {
  const merged = {};
  for (const src of sources) {
    for (const [clerk, cats] of Object.entries(src)) {
      if (!merged[clerk]) merged[clerk] = {};
      for (const [key, vals] of Object.entries(cats)) {
        if (!merged[clerk][key]) merged[clerk][key] = { qty: 0, amount: 0, profit: 0 };
        merged[clerk][key].qty += vals.qty;
        merged[clerk][key].amount += vals.amount;
        merged[clerk][key].profit += vals.profit;
      }
    }
  }
  // 补全四个分类 + 计算占比/毛利率
  const result = {};
  for (const [clerk, cats] of Object.entries(merged)) {
    let totalQty = 0, totalAmount = 0, totalProfit = 0;
    const categories = {};
    for (const key of Object.keys(CATEGORY_LABEL)) {
      const v = cats[key] || { qty: 0, amount: 0, profit: 0 };
      totalQty += v.qty;
      totalAmount += v.amount;
      totalProfit += v.profit;
      categories[key] = { ...v };
    }
    for (const key of Object.keys(CATEGORY_LABEL)) {
      const v = categories[key];
      v.share = totalQty > 0 ? v.qty / totalQty : 0;
      v.marginRate = v.amount > 0 ? v.profit / v.amount : 0;
    }
    result[clerk] = {
      totalQty, totalAmount, totalProfit,
      overallMargin: totalAmount > 0 ? totalProfit / totalAmount : 0,
      categories,
    };
  }
  return result;
}
const milkByClerk = mergeMilkSales(cloudByClerk, bondedByClerk);
// 上月（环比基准）：奶粉销售额/订单数
const cloudByClerkPrev = aggregateMilkSales(
  { ...csm, catField: '奶粉品类（细分）', qtyField: '数量', amountField: '销售金额', profitField: '商品毛利' },
  LAST_MONTH
);
const bondedByClerkPrev = aggregateMilkSales(
  { ...bsm, catField: '奶粉分类（细）', qtyField: '销售/退货数量', refundField: '退款数量', amountField: 'GMV（支付金额）', profitField: '门店收益（不含手续费）' },
  LAST_MONTH
);
const milkByClerkPrev = mergeMilkSales(cloudByClerkPrev, bondedByClerkPrev);

// ─── Non-milk category aggregation（营养品 / 纸品用品 / 零辅食）───
const NON_MILK_MAP = {
  '营养品': 'nutrition', '营养保健': 'nutrition',
  '纸品': 'supplies', '用品': 'supplies', '洗护': 'supplies',
  '零辅食': 'snacks', '乳制品': 'snacks', '食品类': 'snacks',
};
const NON_MILK_LABEL = { nutrition: '营养品', supplies: '纸品用品', snacks: '零辅食' };
function aggregateNonMilk(mapSpec, monthFilter) {
  const byClerk = {};
  for (const row of mapSpec.rows) {
    const m = ev(val(row, mapSpec.map, '年月')) || '';
    if (monthFilter && m !== monthFilter) continue;
    const clerk = getClerkName(row, mapSpec.map);
    if (!clerk || clerk === '空白') continue;
    const cat = String(ev(val(row, mapSpec.map, '二级分类')) || '').trim();
    const key = NON_MILK_MAP[cat];
    if (!key) continue; // only 3 non-milk groups
    const qty = num(row, mapSpec.map, mapSpec.qtyField);
    const refund = mapSpec.refundField ? num(row, mapSpec.map, mapSpec.refundField) : 0;
    const netQty = qty - refund;
    const amount = num(row, mapSpec.map, mapSpec.amountField);
    const profit = num(row, mapSpec.map, mapSpec.profitField);
    if (!byClerk[clerk]) byClerk[clerk] = {};
    if (!byClerk[clerk][key]) byClerk[clerk][key] = { qty: 0, amount: 0, profit: 0 };
    byClerk[clerk][key].qty += netQty;
    byClerk[clerk][key].amount += amount;
    byClerk[clerk][key].profit += profit;
  }
  return byClerk;
}
const nmCloud = aggregateNonMilk(
  { ...csm, qtyField: '数量', amountField: '销售金额', profitField: '商品毛利' },
  REPORT_MONTH
);
const nmBonded = aggregateNonMilk(
  { ...bsm, qtyField: '销售/退货数量', refundField: '退款数量', amountField: 'GMV（支付金额）', profitField: '门店收益（不含手续费）' },
  REPORT_MONTH
);
function mergeNonMilk(...sources) {
  const merged = {};
  for (const src of sources) {
    for (const [clerk, cats] of Object.entries(src)) {
      if (!merged[clerk]) merged[clerk] = {};
      for (const [key, vals] of Object.entries(cats)) {
        if (!merged[clerk][key]) merged[clerk][key] = { qty: 0, amount: 0, profit: 0 };
        merged[clerk][key].qty += vals.qty;
        merged[clerk][key].amount += vals.amount;
        merged[clerk][key].profit += vals.profit;
      }
    }
  }
  const result = {};
  for (const [clerk, cats] of Object.entries(merged)) {
    let totalQty = 0, totalAmount = 0, totalProfit = 0;
    const categories = {};
    for (const key of Object.keys(NON_MILK_LABEL)) {
      const v = cats[key] || { qty: 0, amount: 0, profit: 0 };
      totalQty += v.qty;
      totalAmount += v.amount;
      totalProfit += v.profit;
      categories[key] = { ...v };
    }
    for (const key of Object.keys(NON_MILK_LABEL)) {
      const v = categories[key];
      v.share = totalQty > 0 ? v.qty / totalQty : 0;
      v.marginRate = v.amount > 0 ? v.profit / v.amount : 0;
    }
    result[clerk] = {
      totalQty, totalAmount, totalProfit,
      overallMargin: totalAmount > 0 ? totalProfit / totalAmount : 0,
      categories,
    };
  }
  return result;
}
const nonMilkByClerk = mergeNonMilk(nmCloud, nmBonded);
// 上月（环比基准）：其他产品(非奶粉)销售额/订单数
const nmCloudPrev = aggregateNonMilk(
  { ...csm, qtyField: '数量', amountField: '销售金额', profitField: '商品毛利' },
  LAST_MONTH
);
const nmBondedPrev = aggregateNonMilk(
  { ...bsm, qtyField: '销售/退货数量', refundField: '退款数量', amountField: 'GMV（支付金额）', profitField: '门店收益（不含手续费）' },
  LAST_MONTH
);
const nonMilkByClerkPrev = mergeNonMilk(nmCloudPrev, nmBondedPrev);

// ─── 客单价拆分：奶粉客单价 vs 其他产品(非奶粉)客单价 ───
// 订单级口径：全品类客单价 = 订单总额 ÷ 订单数。从门店云(单号) + 直营保税(订单号) 取订单级明细，
// 奶粉订单 = 四类奶粉(主推/儿童/特配/通货)，其他产品订单 = 营养品/纸品用品/零辅食(与 nonMilkByClerk 口径一致)。
// 同一物理订单若同时含奶粉与非奶粉，会分别计入两类订单集合（按"含该类商品的订单均价"口径）。
function collectOrderCounts(mapSpec, monthFilter = REPORT_MONTH) {
  const milk = {}, nonMilk = {};
  for (const row of mapSpec.rows) {
    const m = ev(val(row, mapSpec.map, '年月')) || '';
    if (m !== monthFilter) continue;
    const clerk = getClerkName(row, mapSpec.map);
    if (!clerk || clerk === '空白') continue;
    const bill = ev(val(row, mapSpec.map, mapSpec.billField));
    if (!bill) continue;
    const key = mapSpec.prefix + ':' + bill;
    const milkCat = String(ev(val(row, mapSpec.map, mapSpec.catField)) || '').trim();
    if (CATEGORY_KEY[milkCat]) (milk[clerk] ||= new Set()).add(key);
    const nonMilkCat = String(ev(val(row, mapSpec.map, '二级分类')) || '').trim();
    if (NON_MILK_MAP[nonMilkCat]) (nonMilk[clerk] ||= new Set()).add(key);
  }
  return { milk, nonMilk };
}
const ocCloud = collectOrderCounts({ ...csm, billField: '单号', catField: '奶粉品类（细分）', prefix: 'C' });
const ocBonded = collectOrderCounts({ ...bsm, billField: '订单号', catField: '奶粉分类（细）', prefix: 'B' });
const ocCloudPrev = collectOrderCounts({ ...csm, billField: '单号', catField: '奶粉品类（细分）', prefix: 'C' }, LAST_MONTH);
const ocBondedPrev = collectOrderCounts({ ...bsm, billField: '订单号', catField: '奶粉分类（细）', prefix: 'B' }, LAST_MONTH);
const milkOrders = {}, nonMilkOrders = {};
const milkOrdersPrev = {}, nonMilkOrdersPrev = {};
function unionInto(target, src) {
  for (const [clerk, set] of Object.entries(src)) {
    if (!target[clerk]) target[clerk] = new Set();
    for (const k of set) target[clerk].add(k);
  }
}
unionInto(milkOrders, ocCloud.milk);
unionInto(milkOrders, ocBonded.milk);
unionInto(nonMilkOrders, ocCloud.nonMilk);
unionInto(nonMilkOrders, ocBonded.nonMilk);
unionInto(milkOrdersPrev, ocCloudPrev.milk);
unionInto(milkOrdersPrev, ocBondedPrev.milk);
unionInto(nonMilkOrdersPrev, ocCloudPrev.nonMilk);
unionInto(nonMilkOrdersPrev, ocBondedPrev.nonMilk);
// 客单价 = 该类销售额 ÷ 该类订单数（销售额复用 milkByClerk / nonMilkByClerk 的 totalAmount，保证口径一致）
// 环比 = (本月客单价 − 上月客单价) ÷ 上月客单价，上月无数据则记为 null（前端显示 —）
const AOV = {};
for (const name of new Set([...Object.keys(milkOrders), ...Object.keys(nonMilkOrders),
  ...Object.keys(milkByClerk), ...Object.keys(nonMilkByClerk)])) {
  const milkAmt = milkByClerk[name]?.totalAmount || 0;
  const milkCnt = milkOrders[name]?.size || 0;
  const milkAov = milkCnt > 0 ? milkAmt / milkCnt : 0;
  const nonMilkAmt = nonMilkByClerk[name]?.totalAmount || 0;
  const nonMilkCnt = nonMilkOrders[name]?.size || 0;
  const nonMilkAov = nonMilkCnt > 0 ? nonMilkAmt / nonMilkCnt : 0;
  const milkAmtPrev = milkByClerkPrev[name]?.totalAmount || 0;
  const milkCntPrev = milkOrdersPrev[name]?.size || 0;
  const milkAovPrev = milkCntPrev > 0 ? milkAmtPrev / milkCntPrev : 0;
  const nonMilkAmtPrev = nonMilkByClerkPrev[name]?.totalAmount || 0;
  const nonMilkCntPrev = nonMilkOrdersPrev[name]?.size || 0;
  const nonMilkAovPrev = nonMilkCntPrev > 0 ? nonMilkAmtPrev / nonMilkCntPrev : 0;
  // 本月无该类订单则环比无基准则记 null（前端显示 —），避免用占位 0 算出的误导↓100%
  AOV[name] = {
    milkAov, milkOrderCnt: milkCnt, milkAovQoq: milkCnt > 0 ? _mom(milkAov, milkAovPrev) : null,
    nonMilkAov, nonMilkOrderCnt: nonMilkCnt, nonMilkAovQoq: nonMilkCnt > 0 ? _mom(nonMilkAov, nonMilkAovPrev) : null,
  };
}

// ═══════════════════════════════════════════════════════════════
// 用户指标（运营概览重构）：成交/企微总量、当日成交拆解、复购拆解、新增
// 口径（与华仔确认）：
//   ① 成交用户总量 = 历史去重客户数（按客户手机）；企微用户总量 = 企微成员统计.客户总数
//   ② 当日 = 脚本运行当天（本地时区），当日成交用户 = 当天下单去重客户
//   ③ 当日 奶粉/其他 互斥优先奶粉：当天买过奶粉→奶粉用户；否则只买非奶粉→其他用户（两数相加=当日总量）
//   ④ 奶粉四类互斥：按优先级 主推>特配>儿童>通货 归一（四类之和=奶粉用户量）
//   ⑤ 复购用户 = 历史累计下单 ≥2 次的客户
//   ⑥ 活跃/稳定/流失 仅针对复购用户：活跃=近90天≥3单；稳定=近90天1-2单；流失=末单在90天前（三类之和=复购总量）
//   ⑦ 新增成交 = 本月首次成交（历史首单在本月）
// ═══════════════════════════════════════════════════════════════
// 当日（优先级）：① 环境变量 STORE_OPS_TODAY（YYYY-MM-DD）② 脚本运行当天 ③ 若当天全店无成交则自动回退到最近有数据的日期
const DAY_MS = 86400000;
const _now = new Date();
function _toLocalDate(y, m, d) { return new Date(y, m - 1, d); }
function _fmtD(dt) { return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`; }
const _todayEnv = (process.env.STORE_OPS_TODAY || '').trim();
let today0;
if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(_todayEnv)) {
  const [ty, tm, td] = _todayEnv.split('-').map(Number);
  today0 = _toLocalDate(ty, tm, td);
} else {
  today0 = _toLocalDate(_now.getFullYear(), _now.getMonth() + 1, _now.getDate());
  // 自动回退：扫描销售明细的可用日期，若运行当天无数据则取最近一个有数据的日期
  const avail = new Set();
  function _collectDates(mapSpec, dateField) {
    for (const row of mapSpec.rows) {
      const dt = parseSaleDate(val(row, mapSpec.map, dateField));
      if (dt) avail.add(_fmtD(dt));
    }
  }
  _collectDates({ ...csm }, '日期');
  _collectDates({ ...bsm }, '创建时间');
  if (!avail.has(_fmtD(today0)) && avail.size > 0) {
    const latest = [...avail].sort().pop();
    const [ry, rm, rd] = latest.split('-').map(Number);
    today0 = _toLocalDate(ry, rm, rd);
    console.log(`ℹ️ 运行当天无成交数据，自动回退到最近有数据日期：${_fmtD(today0)}`);
  }
}
const TODAY_STR = _fmtD(today0);
const d90ago = new Date(today0.getTime() - 90 * DAY_MS);
// 报表月首日（用于"本月首次成交"判定）
const _rmY = Number(REPORT_MONTH.slice(0, 4)), _rmM = Number(REPORT_MONTH.slice(5, 7));
const reportMonthStart = new Date(_rmY, _rmM - 1, 1);

// 解析销售明细日期为本地 Date（支持 "2026-07-21 00:00:00"、"2026-07-21"、Excel 序列号）
function parseSaleDate(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return new Date(Date.UTC(1899, 11, 30) + v * DAY_MS);
  const s = String(v).trim().slice(0, 10).replace(/\//g, '-');
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const t = Date.parse(String(v));
  return isNaN(t) ? null : new Date(t);
}
// 奶粉四类互斥优先级（数值越小优先级越高）
const MILK_PRIORITY = { main: 0, special: 1, child: 2, general: 3 }; // 主推>特配>儿童>通货

// 构建客户订单索引：{ clerk: { phone: { orders:Set(billKey), firstDate, lastDate, cnt90d:Set(billKey),
//   today:{hasMilk:Boolean, milkCats:Set(key), hasNonMilk:Boolean} } } }
function buildCustomerOrderIndex() {
  const idx = {};
  function ensure(clerk, phone) {
    if (!idx[clerk]) idx[clerk] = {};
    if (!idx[clerk][phone]) idx[clerk][phone] = {
      orders: new Set(), firstDate: null, lastDate: null, cnt90d: new Set(),
      today: { hasMilk: false, milkCats: new Set(), hasNonMilk: false },
    };
    return idx[clerk][phone];
  }
  function ingest(mapSpec, dateField, billField, phoneField, milkCatField, prefix) {
    for (const row of mapSpec.rows) {
      const clerk = getClerkName(row, mapSpec.map);
      if (!clerk || clerk === '空白') continue;
      const phone = String(ev(val(row, mapSpec.map, phoneField)) || '').trim();
      if (!phone) continue; // 无手机号无法按人统计
      const bill = ev(val(row, mapSpec.map, billField));
      if (!bill) continue;
      const date = parseSaleDate(val(row, mapSpec.map, dateField));
      if (!date) continue;
      const billKey = prefix + ':' + bill;
      const rec = ensure(clerk, phone);
      rec.orders.add(billKey);
      if (!rec.firstDate || date < rec.firstDate) rec.firstDate = date;
      if (!rec.lastDate || date > rec.lastDate) rec.lastDate = date;
      if (date >= d90ago) rec.cnt90d.add(billKey);
      // 当日订单的品类归属
      const isToday = date.getFullYear() === today0.getFullYear() && date.getMonth() === today0.getMonth() && date.getDate() === today0.getDate();
      if (isToday) {
        const milkCat = String(ev(val(row, mapSpec.map, milkCatField)) || '').trim();
        const mKey = CATEGORY_KEY[milkCat];
        if (mKey) { rec.today.hasMilk = true; rec.today.milkCats.add(mKey); }
        const nmCat = String(ev(val(row, mapSpec.map, '二级分类')) || '').trim();
        if (NON_MILK_MAP[nmCat]) rec.today.hasNonMilk = true;
      }
    }
  }
  ingest({ ...csm }, '日期', '单号', '客户手机', '奶粉品类（细分）', 'C');
  ingest({ ...bsm }, '创建时间', '订单号', '客户手机', '奶粉分类（细）', 'B');
  return idx;
}
const CUST_IDX = buildCustomerOrderIndex();

// 计算单个店员的用户指标
function computeUserMetrics(clerk) {
  const custMap = CUST_IDX[clerk] || {};
  const phones = Object.keys(custMap);
  const totalClients = phones.length; // 成交用户总量（历史去重，按手机）
  // 当日成交拆解
  let todayTotal = 0, todayMilk = 0, todayNonMilk = 0, todayNew = 0, todayRep = 0;
  const milkCatCount = { main: 0, special: 0, child: 0, general: 0 }; // 主推/特配/儿童/通货
  // 复购拆解
  let repTotal = 0, repActive = 0, repStable = 0, repChurned = 0;
  // 新增（本月首次成交）
  let newThisMonth = 0;
  for (const phone of phones) {
    const c = custMap[phone];
    // 当日
    const t = c.today;
    if (t.hasMilk || t.hasNonMilk) {
      todayTotal++;
      // 当日成交用户细分：新增（首单日期=当日）vs 复购（首单日期<当日）
      if (c.firstDate && c.firstDate === TODAY_STR) todayNew++;
      else todayRep++;
      if (t.hasMilk) {
        todayMilk++;
        // 奶粉四类互斥：取优先级最高的一类
        let best = null;
        for (const k of t.milkCats) { if (best === null || MILK_PRIORITY[k] < MILK_PRIORITY[best]) best = k; }
        if (best) milkCatCount[best]++;
      } else {
        todayNonMilk++;
      }
    }
    // 复购（历史累计≥2）
    const totalOrders = c.orders.size;
    if (totalOrders >= 2) {
      repTotal++;
      const n90 = c.cnt90d.size;
      const lastIn90 = c.lastDate && c.lastDate >= d90ago;
      if (lastIn90 && n90 >= 3) repActive++;
      else if (lastIn90 && n90 >= 1) repStable++;
      else repChurned++; // 末单在90天前
    }
    // 新增：历史首单在本月
    if (c.firstDate && c.firstDate >= reportMonthStart) newThisMonth++;
  }
  const wmem = wecomMemberMap[clerk] || {};
  return {
    totalClients,
    qwTotal: wmem.qwTotal ?? null,
    qwTodayNew: wmem.qwTodayNew ?? null,
    today: {
      date: TODAY_STR, total: todayTotal, milk: todayMilk, nonMilk: todayNonMilk,
      new: todayNew, rep: todayRep,
      milkCat: {
        zhutui: milkCatCount.main, tepei: milkCatCount.special,
        ertong: milkCatCount.child, tonghuo: milkCatCount.general,
      },
    },
    repurchase: { total: repTotal, active: repActive, stable: repStable, churned: repChurned },
    newThisMonth,
  };
}
console.log('✅ 用户指标计算模块就绪（当日=' + TODAY_STR + '，近90天自 ' + `${d90ago.getFullYear()}-${String(d90ago.getMonth() + 1).padStart(2, '0')}-${String(d90ago.getDate()).padStart(2, '0')}` + '）');

// ─── Load local asset manifest (downloaded from Feishu, served via OSS) ───
let assetManifest = {};
try {
  // 优先从 STORE_OPS_ROOT/deploy/assets/manifest.json 加载（兼容自包含模式）
  const mPath = process.env.STORE_OPS_ROOT
    ? path.resolve(process.env.STORE_OPS_ROOT, 'deploy', 'assets', 'manifest.json')
    : path.resolve(__dirname, '..', 'deploy', 'assets', 'manifest.json');
  assetManifest = JSON.parse(fs.readFileSync(mPath, 'utf-8'));
} catch (_) { console.log('⚠️ assets/manifest.json not found, will fall back to Feishu URLs'); }

// ─── Parse product KB ───
const productMap = {};
for (const row of pm.rows) {
  const pname = ev(val(row, pm.map, '产品')) || '';
  if (!pname) continue;
  const am = assetManifest[pname] || {};
  const feishuOnepager = ev(val(row, pm.map, '一页纸')) || ev(val(row, pm.map, '一页纸URL')) || '';
  const feishuTest = ev(val(row, pm.map, '测试题')) || '';
  productMap[pname] = {
    onepager: am.onepager || feishuOnepager,
    video: am.video || '', // 压缩后的本地视频（已入仓 GitHub Pages）
    poster: am.poster || '', // 视频封面缩略图（秒开，避免预加载整段视频）
    test: am.test || feishuTest,
    brand: ev(val(row, pm.map, '母品牌')) || '',
    subBrand: ev(val(row, pm.map, '子品牌')) || '',
    comp: ev(val(row, pm.map, '竞品分析')) || '',
    speech: ev(val(row, pm.map, '销售话术')) || '',
  };
}

// ═══ Build User Data ═══
const users = {};
const allNames = new Set();
for (const row of im.rows) allNames.add(ev(val(row, im.map, '【标准】店员名字')) || '');
for (const row of cm.rows) allNames.add(ev(val(row, cm.map, '店员')) || '');

// 预读已有店员数据，保留 followUp 等由其他脚本补充的字段（防止重写时丢失）
fs.mkdirSync(dataDir, { recursive: true }); // 确保目录存在（首次运行/全新工作区也可移植）
const prevData = {};
for (const f of fs.readdirSync(dataDir)) {
  if (!f.endsWith('.json') || f === 'version.json') continue;
  try {
    const d = JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf-8'));
    if (d && d.name) prevData[d.name] = d;
  } catch (_) {}
}

for (const name of allNames) {
  if (!name || name === '空白') continue;

  // Find incentive row (七月=当前月，六月=上月用于环比)
  const iRow = im.rows.find(r => ev(val(r, im.map, '【标准】店员名字')) === name && ev(val(r, im.map, '年月')) === REPORT_MONTH);
  const iRowPrev = im.rows.find(r => ev(val(r, im.map, '【标准】店员名字')) === name && ev(val(r, im.map, '年月')) !== REPORT_MONTH);
  const lastMonthAchieved = iRowPrev ? num(iRowPrev, im.map, '店员销售业绩达成') : 0;
  const lastMonthTarget = iRowPrev ? num(iRowPrev, im.map, '店员销售目标') : 0;
  const cRow = cm.rows.find(r => ev(val(r, cm.map, '店员')) === name);

  if (!iRow && !cRow) continue;

  const si = staffInfo[name] || {};
  const us = usInfo[name] || {};

  // Incentive data
  const target = num(iRow, im.map, '店员销售目标');
  const achieved = num(iRow, im.map, '店员销售业绩达成');
  const achievementRate = num(iRow, im.map, '店员达成率');
  const commission = num(iRow, im.map, '提成合计');
  const isManager = ev(val(iRow, im.map, '是否店长/见习店长')) === '是';
  const commissionShangpin = num(iRow, im.map, '商品销售提成合计');
  const commissionFujian = num(iRow, im.map, '主推附件激励合计');
  const commissionBaojin = num(iRow, im.map, '保证金提成合计');
  const commissionJishi = num(iRow, im.map, '店员即时零售提成');
  const commissionManager = num(iRow, im.map, '见习店长提成');
  const mendianDachengLv = num(iRow, im.map, '门店销售达成率');
  const mendianStaffCount = num(iRow, im.map, '门店店员数');

  // ── 销售额环比 & 日均 ──
  const salesMom = lastMonthAchieved > 0 ? (achieved - lastMonthAchieved) / lastMonthAchieved : null;
  const daysPassed = new Date().getDate();
  const dailyAvg = daysPassed > 0 ? achieved / daysPassed : 0;
  const daysInPrev = new Date(new Date().getFullYear(), new Date().getMonth(), 0).getDate(); // last month days
  const dailyAvgLast = daysInPrev > 0 ? lastMonthAchieved / daysInPrev : 0;
  const dailyAvgMom = dailyAvgLast > 0 ? (dailyAvg - dailyAvgLast) / dailyAvgLast : null;

  // Cockpit data
  const milkCans = num(cRow, cm.map, '奶粉类本月销售罐数');
  const milkCansLast = num(cRow, cm.map, '奶粉类上月销售罐数');
  const milkClients = num(cRow, cm.map, '奶粉类本月用户数');
  const milkClientsLast = num(cRow, cm.map, '奶粉类上月用户数');
  const pushClients = num(cRow, cm.map, '主推奶粉本月合计');
  const pushClientsLast = num(cRow, cm.map, '主推奶粉上月合计');
  const milkAvg = num(cRow, cm.map, '奶粉类本月客单量');
  const milkAvgLast = num(cRow, cm.map, '奶粉类上月客单量');
  
  // Approximate push cans
  const pushCans = Math.round((pushClients / Math.max(milkClients, 1)) * milkCans);
  const pushCansLast = Math.round((pushClientsLast / Math.max(milkClientsLast, 1)) * milkCansLast);

  // Store
  const store = si.store || arr(iRow, im.map, '所属门店').join(', ') || us.storeName || '';
  const region = getRegion(store);

  // Deposit
  const dp = depositCount[name] || 0;

  // User service
  const totalClients = us.totalClients || num(cRow, cm.map, '成交用户本月新增') || 0;
  const totalClientsLast = us.totalClientsLast || num(cRow, cm.map, '成交用户上月新增') || 0;
  const visitShould = us.visitShould || 0;
  const visitDone = us.visitDone || 0;
  const visitPending = us.visitPending || 0;

  // Mom rates
  const momClients = _mom(totalClients, totalClientsLast);
  const momMilkClients = _mom(milkClients, milkClientsLast);
  const momPushClients = _mom(pushClients, pushClientsLast);
  const momMilkAvg = _mom(milkAvg, milkAvgLast);
  const momMilkCans = _mom(milkCans, milkCansLast);
  const momPushCans = _mom(pushCans, pushCansLast);

  users[name] = {
    name, store, region, zaidian: si.zaidian, isManager,
    // Commission
    commission, commissionShangpin, commissionFujian, commissionBaojin,
    commissionJishi, commissionManager,
    // Targets
    target, achieved, achievementRate,
    lastMonthAchieved, lastMonthTarget, salesMom,
    dailyAvg, dailyAvgLast, dailyAvgMom,
    // 用户指标统一按门店定目标：大礼堂店 90，其余店 120
    userTarget: store.includes('大礼堂') ? 90 : 120,
    newCustomers: (wecomMap[name]?.newCustomers) || 0,
    customerService: {
      newServiceCount: us.newServiceCount || 0,
      chatTotal: us.chatTotal || 0,
      msgSent: us.msgSent || 0,
      replyRate: us.replyRate || 0,
      firstReplyMin: us.firstReplyMin || 0,
    },
    mendianDachengLv, mendianStaffCount,
    // Sales
    milkCans, milkCansLast, momMilkCans,
    pushCans, pushCansLast, momPushCans,
    // Milk category breakdown (主推/儿童/特配/通货：销量、占比、毛利率)
    milkByCategory: milkByClerk[name] || {
      totalQty: 0, totalAmount: 0, totalProfit: 0, overallMargin: 0,
      categories: {
        main: { qty: 0, amount: 0, profit: 0, share: 0, marginRate: 0 },
        general: { qty: 0, amount: 0, profit: 0, share: 0, marginRate: 0 },
        special: { qty: 0, amount: 0, profit: 0, share: 0, marginRate: 0 },
        child: { qty: 0, amount: 0, profit: 0, share: 0, marginRate: 0 },
      },
    },
    // Non-milk category breakdown（营养品 / 纸品用品 / 零辅食）
    nonMilkByCategory: nonMilkByClerk[name] || {
      totalQty: 0, totalAmount: 0, totalProfit: 0, overallMargin: 0,
      categories: {
        nutrition: { qty: 0, amount: 0, profit: 0, share: 0, marginRate: 0 },
        supplies: { qty: 0, amount: 0, profit: 0, share: 0, marginRate: 0 },
        snacks: { qty: 0, amount: 0, profit: 0, share: 0, marginRate: 0 },
      },
    },
    // Clients
    totalClients, totalClientsLast, momClients,
    milkClients, milkClientsLast, momMilkClients,
    pushClients, pushClientsLast, momPushClients,
    // Milk
    milkAvg, milkAvgLast, momMilkAvg,
    // Deposit
    depositCount: dp,
    // Visit
    visitShould, visitDone, visitPending,
    // Old fields (keep for compatibility)
    naifenUsers: milkClients,
    naifenUsersLast: milkClientsLast,
    naifenGuanshu: milkCans,
    naifenGuanshuLast: milkCansLast,
    kedanjia: num(cRow, cm.map, '本月全品类客单价') || 0,
    kedanjiaQoq: num(cRow, cm.map, '全品类客单价上月环比') || null,
    // 客单价拆分（订单口径：销售额÷订单数）：奶粉 vs 其他产品(营养品/纸品用品/零辅食)
    milkAov: AOV[name]?.milkAov || 0,
    milkOrderCnt: AOV[name]?.milkOrderCnt || 0,
    milkAovQoq: AOV[name]?.milkAovQoq ?? null,
    nonMilkAov: AOV[name]?.nonMilkAov || 0,
    nonMilkOrderCnt: AOV[name]?.nonMilkOrderCnt || 0,
    nonMilkAovQoq: AOV[name]?.nonMilkAovQoq ?? null,
    kedanliang: milkAvg,
    kedanliangLast: milkAvgLast,
    chengjiaoNew: totalClients,
    chengjiaoNewLast: totalClientsLast,
    chengjiaoTotal: num(cRow, cm.map, '成交用户累计总量') || 0,
    fugouRate: num(cRow, cm.map, '本月复购用户占比') || 0,
    zhutuiUsers: pushClients, zhutuiUsersLast: pushClientsLast,
    tonghuoUsers: num(cRow, cm.map, '通货奶粉本月合计') || 0,
    tonghuoUsersLast: num(cRow, cm.map, '通货奶粉上月合计') || 0,
    bindWecom: num(cRow, cm.map, '绑定企微&手机用户数') || 0,
    haoyouTotal: num(cRow, cm.map, '好友累计总量') || 0,
    sankeUsers: num(cRow, cm.map, '本月散客用户数量') || 0,
    sankeUsersLast: num(cRow, cm.map, '上月散客用户数量') || 0,
    jishiOrders: num(cRow, cm.map, '即时零售本月单量') || 0,
    jishiOrdersLast: num(cRow, cm.map, '即时零售上月单量') || 0,
    liushiUsers: num(cRow, cm.map, '本月流失用户数量') || 0,
    liushiUsersLast: num(cRow, cm.map, '上月流失用户数量') || 0,
    updatedAt: '',
    month: REPORT_MONTH,
    version: 'v2',
    // Rankings (filled later)
    storeRank: 0, storeTotal: 0, storeTopName: '', storeTopComm: 0,
    regionRank: 0, regionTotal: 0, regionTopName: '', regionTopComm: 0,
    nationRank: 0, nationTotal: 0, nationTopName: '', nationTopComm: 0,
    // Suggestions & learning
    learningResources: '',
    followUp: prevData[name]?.followUp || null,
    productKb: productMap,
    // 用户指标（运营概览重构：成交/企微总量、当日拆解、复购拆解、新增）
    userMetrics: computeUserMetrics(name),
  };
}

// ═══ Rankings ═══
// By store
const storeGroups = {};
for (const [name, u] of Object.entries(users)) {
  const s = u.store || '未知门店';
  if (!storeGroups[s]) storeGroups[s] = [];
  storeGroups[s].push(name);
}
for (const [store, names] of Object.entries(storeGroups)) {
  const sorted = names.sort((a, b) => (users[b].commission || 0) - (users[a].commission || 0));
  const topName = sorted[0];
  const topComm = users[topName].commission;
  sorted.forEach((n, i) => {
    users[n].storeRank = i + 1;
    users[n].storeTotal = sorted.length;
    users[n].storeTopName = topName === n ? '（你）' : topName;
    users[n].storeTopComm = topComm;
  });
}

// By region
const regionGroups = {};
for (const [name, u] of Object.entries(users)) {
  const r = u.region || '未知区域';
  if (!regionGroups[r]) regionGroups[r] = [];
  regionGroups[r].push(name);
}
for (const [region, names] of Object.entries(regionGroups)) {
  const sorted = names.sort((a, b) => (users[b].commission || 0) - (users[a].commission || 0));
  const topName = sorted[0];
  const topComm = users[topName].commission;
  sorted.forEach((n, i) => {
    users[n].regionRank = i + 1;
    users[n].regionTotal = sorted.length;
    users[n].regionTopName = topName === n ? '（你）' : topName;
    users[n].regionTopComm = topComm;
  });
}

// By nation（全国 = 当前全部店员大排名，按业绩奖励 commission 降序）
{
  const sorted = Object.keys(users).sort((a, b) => (users[b].commission || 0) - (users[a].commission || 0));
  const topName = sorted[0];
  const topComm = users[topName] ? users[topName].commission : 0;
  sorted.forEach((n, i) => {
    users[n].nationRank = i + 1;
    users[n].nationTotal = sorted.length;
    users[n].nationTopName = topName === n ? '（你）' : topName;
    users[n].nationTopComm = topComm;
  });
}

// ═══ Regional GMV Benchmarks（业绩最好 + 主推卖最多）═══
const regionBM = {};
const _gmv = (u) => (u.totalClients || 0) * (u.kedanjia || 0) * (u.fugouRate || 0);
const _gmvComps = (u) => ({
  traffic: u.totalClients || 0,
  aov: u.kedanjia || 0,
  milkAov: u.milkAov || 0,
  nonMilkAov: u.nonMilkAov || 0,
  repRate: u.fugouRate || 0,
});
for (const [region, names] of Object.entries(regionGroups)) {
  const topSalesName = [...names].sort((a,b) => (users[b].achieved||0) - (users[a].achieved||0))[0];
  const topPushName = [...names].sort((a,b) => (users[b].pushCans||0) - (users[a].pushCans||0))[0];
  const ts = users[topSalesName];
  const tp = users[topPushName];
  regionBM[region] = {
    topSales: { name: topSalesName, achieved: ts.achieved, gmv: _gmv(ts), components: _gmvComps(ts) },
    topPush:  { name: topPushName,  pushCans: tp.pushCans, gmv: _gmv(tp), components: _gmvComps(tp) },
  };
}
// 每个店员与区域标杆的差距（每个组件分别算 gap）
for (const [name, u] of Object.entries(users)) {
  const bm = regionBM[u.region];
  const myGmv = _gmv(u);
  const myComps = _gmvComps(u);
  const compGaps = (bench) => {
    if (!bench || !bench.components) return null;
    const c = bench.components;
    return {
      traffic: c.traffic > 0 ? (myComps.traffic - c.traffic) / c.traffic : null,
      aov: c.aov > 0 ? (myComps.aov - c.aov) / c.aov : null,
      milkAov: c.milkAov > 0 ? (myComps.milkAov - c.milkAov) / c.milkAov : null,
      nonMilkAov: c.nonMilkAov > 0 ? (myComps.nonMilkAov - c.nonMilkAov) / c.nonMilkAov : null,
      repRate: c.repRate > 0 ? (myComps.repRate - c.repRate) / c.repRate : null,
    };
  };
  u.regionalBM = {
    topSales: {
      name: bm?.topSales.name || '', gmv: bm?.topSales.gmv || 0,
      gap: (bm?.topSales.gmv > 0) ? (myGmv - bm.topSales.gmv) / bm.topSales.gmv : null,
      components: bm?.topSales.components || null,
      componentGaps: compGaps(bm?.topSales),
    },
    topPush: {
      name: bm?.topPush.name || '', gmv: bm?.topPush.gmv || 0,
      gap: (bm?.topPush.gmv > 0) ? (myGmv - bm.topPush.gmv) / bm.topPush.gmv : null,
      components: bm?.topPush.components || null,
      componentGaps: compGaps(bm?.topPush),
    },
    myGmv, myComponents: myComps,
  };
}

// ═══ Store-level aggregation ═══
const storeAgg = {};
for (const [store, names] of Object.entries(storeGroups)) {
  let sTarget = 0, sAchieved = 0, sMilk = 0, sMilkLast = 0, sPush = 0;
  for (const n of names) {
    sTarget += users[n].target;
    sAchieved += users[n].achieved;
    sMilk += users[n].milkCans;
    sMilkLast += users[n].milkCansLast;
    sPush += users[n].pushCans;
  }
  storeAgg[store] = {
    target: sTarget, achieved: sAchieved,
    achievementRate: sTarget > 0 ? sAchieved / sTarget : 0,
    milkCans: sMilk, momMilkCans: _mom(sMilk, sMilkLast),
    pushCans: sPush, momPushCans: _mom(sPush, 0),
  };
}

// ═══ Suggestions & Learning (客户服务视角) ═══
// 注意：原 genSuggestion 函数已删除（前端 renderAction 不读取 u.suggestion 字段，改由 buildDailyActionPlan 在前端生成）
// 建议文案来源：skills/store-action-advisor/references/playbook.md

// 主推产品：能恩全护A2（KB产品名"全护A2"）、臻护新笙（KB子品牌"臻护新苼"，含皇家A2/至尊A2/铂金/羊奶）
const MAIN_PUSH = [
  { name: '能恩全护A2', kbKey: '全护A2', subBrand: null, scenario: '消化吸收、免疫支持', age: '0-3岁' },
  { name: '臻护新笙', kbKey: null, subBrand: '臻护新苼', scenario: '新生儿、早产儿、敏感体质', age: '0-12个月' },
];

// 按主推产品配置从 KB 中提取学习资源
function getPushProducts(kb) {
  const result = [];
  for (const mp of MAIN_PUSH) {
    if (mp.kbKey) {
      // 单产品：直接按产品名查找
      const info = kb[mp.kbKey];
      if (info) result.push({ name: mp.name, ...info });
    } else if (mp.subBrand) {
      // 多产品：按子品牌查找所有匹配产品
      for (const [pname, info] of Object.entries(kb)) {
        if (info.subBrand && info.subBrand.includes(mp.subBrand)) {
          result.push({ name: `${mp.name}·${pname}`, ...info });
        }
      }
    }
  }
  return result;
}

function genLearning(u) {
  const milk = u.milkClients || 0;
  const push = u.pushClients || 0;
  const pcLast = u.pushCansLast || 0;
  const pc = u.pushCans || 0;
  const kb = u.productKb || {};
  const total = u.totalClients || 0;

  // 推荐学习资源的条件：主推覆盖率低 或 客户有疑问场景
  const pushRatio = milk > 0 ? push / milk : 0;
  let reasons = [];

  if (milk > 0 && pushRatio < 0.5) {
    reasons.push(`${milk} 位奶粉客户中仅 ${push} 位（${Math.round(pushRatio*100)}%）使用过主推产品`);
  }
  if (pcLast > 0 && pc < pcLast) {
    const decline = pcLast - pc;
    reasons.push(`主推罐数环比下降 ${Math.round(decline/pcLast*100)}%（${pcLast}→${pc}罐）`);
  }
  if (milk === 0 && total > 0) {
    reasons.push(`${total} 位成交客户中暂无奶粉用户——这些宝宝可能正在被竞品服务`);
  }

  const pushProducts = getPushProducts(kb);
  const items = pushProducts.map(p => ({
    name: p.name,
    onepager: p.onepager || '',
    video: p.video || '',
    poster: p.poster || '',
    test: p.test || '',
  })).filter(p => p.onepager || p.video || p.test);

  if (items.length === 0) {
    return { intro: '⚠️ 主推产品资料正在更新中，请稍后查看', items: [], tip: '' };
  }

  let intro;
  if (reasons.length === 0) {
    intro = `✅ 你的客户对主推产品的接受度良好。以下 ${items.length} 款主推产品资料供日常参考，随时准备回答客户的个性化问题 👇`;
  } else {
    intro = `👶 你的客户可能错过了更适合的选择（${reasons.join('；')}），以下产品资料能帮你更自信地推荐：`;
  }
  const tip = '💡 不需要全部背下来——每次服务客户前花 2 分钟复习一个产品，逐步建立专业自信。';
  return { intro, items, tip };
}

// ═══ 本周服务清单 ═══
function genWeeklyTasks(u) {
  const milk = u.milkClients || 0;
  const milkLast = u.milkClientsLast || 0;
  const push = u.pushClients || 0;
  const pushLast = u.pushClientsLast || 0;
  const fugou = u.fugouRate || 0;
  const total = u.totalClients || 0;
  const totalLast = u.totalClientsLast || 0;
  const dp = u.depositCount || 0;
  const visitPending = u.visitPending || 0;

  const fugouClients = Math.round(milk * fugou);
  const notFugou = milk - fugouClients;
  const notPush = milk - push;
  const pushDrop = pushLast > push ? pushLast - push : 0;

  const tasks = [];

  if (notFugou > 0) {
    tasks.push({ icon: '📋', text: `联系 ${notFugou} 位本月未复购客户，了解宝宝近况和换品原因` });
  }
  if (notPush > 0) {
    tasks.push({ icon: '🎯', text: `向 ${notPush} 位未接触主推产品的客户介绍适合的奶粉` });
  }
  if (pushDrop > 0) {
    tasks.push({ icon: '🔄', text: `了解 ${pushDrop} 位停止主推产品客户的原因` });
  }
  if (visitPending > 0) {
    tasks.push({ icon: '📞', text: `完成 ${visitPending} 位待回访客户的跟进` });
  }
  if (dp < 3 && milk > 5) {
    tasks.push({ icon: '🔐', text: `从 ${milk} 位奶粉客户中筛选购买最规律的 3 位，推荐保证金方案` });
  }
  return tasks.length > 0 ? tasks : [{ icon: '✅', text: '本周客户状态良好，继续保持服务节奏' }];
}

// ═══ 客户洞察 ═══
function genCustomerInsights(u) {
  const milk = u.milkClients || 0;
  const milkLast = u.milkClientsLast || 0;
  const push = u.pushClients || 0;
  const pushLast = u.pushClientsLast || 0;
  const fugouRate = u.fugouRate || 0;
  const total = u.totalClients || 0;
  const totalLast = u.totalClientsLast || 0;
  const dp = u.depositCount || 0;
  const avg = u.milkAvg || 0;

  const insights = [];
  const fugouClients = Math.round(milk * fugouRate);
  const notFugou = milk - fugouClients;
  const notPush = milk - push;
  const pushClientDrop = pushLast > push ? pushLast - push : 0;

  if (totalLast > total && total > 0) {
    const drop = totalLast - total;
    const pct = Math.round(drop / totalLast * 100);
    insights.push(`总体客户从 ${totalLast} 降至 ${total}（↓${pct}%），流失 ${drop} 位——每位背后都可能是一个正在换品牌的家庭，越早联系挽回机会越大。`);
  }
  if (milkLast > milk) {
    const drop = milkLast - milk;
    const pct = Math.round(drop / milkLast * 100);
    insights.push(`奶粉客户从 ${milkLast} 降至 ${milk}（↓${pct}%），本月有 ${notFugou} 位未复购。宝宝月龄增长、口味变化、竞品活动都可能是原因——逐一了解才能留住客户。`);
  }
  if (milk > 0 && notPush > 0) {
    const pct = Math.round(push / milk * 100);
    insights.push(`你服务了 ${milk} 位奶粉客户，但只有 ${push} 位（${pct}%）接触过主推产品。其余 ${notPush} 位可能不知道有更适合宝宝的选项——建议从购买量最大的客户开始介绍。`);
  }
  if (pushClientDrop > 0) {
    const pct = Math.round(pushClientDrop / pushLast * 100);
    insights.push(`有 ${pushClientDrop} 位客户停止了主推产品购买（${pushLast}→${push}，↓${pct}%），可能是不适应口感或宝宝需求变化——建议逐一了解原因。`);
  }
  if (dp <= 0) {
    insights.push(`你的 ${milk} 位奶粉客户中没有保证金用户，意味着每月都需要手动跟进复购。购买最规律的客户最适合推荐保证金方案。`);
  } else if (milk > 0 && dp < milk * 0.1) {
    insights.push(`仅 ${dp} 位保证金用户（覆盖率 ${Math.round(dp/milk*100)}%）。保证金用户平均复购率是非保证金用户的 2 倍——优先向高频复购客户推荐。`);
  }
  if (milk > 5 && avg < 2) {
    insights.push(`客户平均每次只买 ${avg.toFixed(1)} 罐，远低于一个阶段 6 罐的需求。帮客户算清阶段用量，推荐整箱购买。`);
  }
  if (insights.length === 0) {
    insights.push('你的客户群整体状态稳定，复购率和主推覆盖率良好。继续保持对宝宝成长节点的关注，在关键窗口期主动提供建议。');
  }
  return insights;
}

// ═══ 产品知识推荐 ═══
function genProductKnowledge(u) {
  const milk = u.milkClients || 0;
  const push = u.pushClients || 0;
  const notPush = milk - push;
  const pushLast = u.pushClientsLast || 0;
  const pushDrop = pushLast > push ? pushLast - push : 0;

  let intro = '';
  if (notPush > 0 && pushDrop > 0) {
    intro = `了解这些产品能帮你判断哪位宝宝的状况更适合哪款奶粉（有 ${notPush} 位奶粉客户未接触过主推产品，${pushDrop} 位客户停止了主推产品）`;
  } else if (notPush > 0) {
    intro = `了解这些产品能帮你更好地为 ${notPush} 位未接触主推产品的客户推荐合适的奶粉`;
  } else if (pushDrop > 0) {
    intro = `了解这些产品能帮 ${pushDrop} 位停止主推产品的客户找到更合适的替代方案`;
  } else {
    intro = '以下是当前主推产品的核心卖点，日常服务中可以随时查阅';
  }

  const products = [];
  const kb = u.productKb || {};
  const pushProducts = getPushProducts(kb);

  for (const mp of MAIN_PUSH) {
    const detail = { scenario: mp.scenario || '', age: mp.age || '' };
    if (mp.kbKey) {
      // 单产品
      const info = kb[mp.kbKey];
      const parts = [];
      if (info?.onepager) parts.push(`[一页纸](${info.onepager})`);
      if (info?.video) parts.push(`[五分钟视频](${info.video})`);
      if (info?.test) parts.push(`[测试题](${info.test})`);
      products.push({
        name: mp.name, brand: info?.brand || '',
        scenario: detail.scenario, age: detail.age,
        links: parts.join(' · '),
      });
    } else if (mp.subBrand) {
      // 多产品：列出子品牌下所有产品
      for (const [pname, info] of Object.entries(kb)) {
        if (info.subBrand && info.subBrand.includes(mp.subBrand)) {
          const parts = [];
          if (info?.onepager) parts.push(`[一页纸](${info.onepager})`);
          if (info?.video) parts.push(`[五分钟视频](${info.video})`);
          if (info?.test) parts.push(`[测试题](${info.test})`);
          products.push({
            name: `${mp.name}·${pname}`, brand: info?.brand || '',
            scenario: detail.scenario, age: detail.age,
            links: parts.join(' · '),
          });
        }
      }
    }
  }

  return { intro, products };
}

for (const [name, u] of Object.entries(users)) {
  u.learningResources = genLearning(u);
  u.weeklyTasks = genWeeklyTasks(u);
  u.customerInsights = genCustomerInsights(u);
  u.productKnowledge = genProductKnowledge(u);
  u.storeAgg = storeAgg[u.store] || {};
  u.version = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19).replace('T', ' ').slice(0, 16);
  u.updatedAt = REPORT_MONTH;
}

// ═══ Write JSON ═══
fs.mkdirSync(dataDir, { recursive: true });
const version = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19).replace('T', ' ').slice(0, 16);
const userList = Object.keys(users);

for (const [name, u] of Object.entries(users)) {
  u.version = version;
  // Round numbers for readability
  for (const k of ['target','achieved','commission','commissionShangpin','commissionFujian','commissionBaojin','commissionJishi','commissionManager','storeTopComm','regionTopComm']) {
    if (u[k]) u[k] = Math.round(u[k] * 100) / 100;
  }
  fs.writeFileSync(path.join(dataDir, `${name}.json`), JSON.stringify(u, null, 2), 'utf-8');
}

fs.writeFileSync(path.join(dataDir, 'version.json'), JSON.stringify({
  version, users: userList, updatedAt: new Date().toISOString(), totalUsers: userList.length,
}, null, 2));

console.log(`✅ ${userList.length} 店员数据已生成 → deploy/data/`);
userList.forEach(n => {
  const u = users[n];
  console.log(`  ${n} | ${u.store} | 第${u.storeRank}/${u.storeTotal}名 | ¥${u.commission?.toFixed(0) || 0}`);
});
console.log(`\n门店:`, Object.keys(storeGroups).join(', '));
console.log(`区域:`, Object.keys(regionGroups).join(', '));

// ═══ 集成回访清单生成 ═══
// parse-data-v2 重写店员 JSON 后会清空 followUp，这里自动运行 merge-trades 补回，避免回访数据丢失
try {
  const { runMergeTrades } = await import('./merge-trades.mjs');
  runMergeTrades();
  console.log('✅ 回访清单已随 parse-data-v2 一并生成');

  // ── 回访清单增强：关联奶粉购买记录（品牌/金额/罐数）──
  function enrichFollowUp() {
    // 从门店云销售 + 直营保税 构建 phone→奶粉购买记录 索引
    const milkByPhone = {};
    for (const src of [cloudSales, bondedSales]) {
      for (const row of src.data.data) {
        const phone = ev(val(row, buildMap(src).map, '客户手机')) || '';
        if (!phone) continue;
        const cat = ev(val(row, buildMap(src).map, src === cloudSales ? '奶粉品类（细分）' : '奶粉分类（细）')) || '';
        const key = CATEGORY_KEY[String(cat).trim()];
        if (!key) continue;
        const date = ev(val(row, buildMap(src).map, '日期')) || '';
        const amount = num(row, buildMap(src).map, src === cloudSales ? '销售金额' : 'GMV（支付金额）');
        const qty = num(row, buildMap(src).map, src === cloudSales ? '数量' : '销售/退货数量');
        const brand = ev(val(row, buildMap(src).map, '商品名称')) || '';
        if (!milkByPhone[phone]) milkByPhone[phone] = [];
        milkByPhone[phone].push({ date, key, brand: brand.slice(0,40), amount, qty });
      }
    }
    // 每个 clerk 的 followUp.list：标记是否为奶粉客户 + 最新奶粉购买详情
    for (const f of fs.readdirSync(dataDir)) {
      if (!f.endsWith('.json') || f === 'version.json') continue;
      const fp = path.join(dataDir, f);
      const d = JSON.parse(fs.readFileSync(fp, 'utf-8'));
      if (!d.followUp?.list?.length) continue;
      let changed = false;
      for (const item of d.followUp.list) {
        const phone = String(item.phone || '').trim();
        const milkRecs = milkByPhone[phone];
        if (milkRecs && milkRecs.length) {
          milkRecs.sort((a,b) => b.date.localeCompare(a.date));
          const latest = milkRecs[0];
          item.isMilk = true;
          item.lastBrand = latest.brand;
          item.lastAmount = latest.amount;
          item.lastCans = latest.qty;
          item.lastCategory = latest.key;
          item.totalMilkAmount = milkRecs.reduce((s,r)=>s+r.amount, 0);
          changed = true;
        } else {
          item.isMilk = false;
          if (!item.hasOwnProperty('isMilk')) changed = true;
        }
      }
      if (changed) fs.writeFileSync(fp, JSON.stringify(d, null, 2));
    }
    console.log('✅ 回访清单已增强：奶粉客户关联品牌/金额/罐数');
  }
  enrichFollowUp();
} catch (e) {
  console.log('⚠️ 回访清单自动生成跳过（保留既有 followUp）：', e.message);
}
