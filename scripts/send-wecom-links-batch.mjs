// send-wecom-links-batch.mjs — 批量推送：给 version.json 全部店员发送各自专属看板链接
// 用法: WECOM_CORPID=wwdf6c862f468f0cb0 WECOM_CORPSECRET=xxx WECOM_AGENTID=1000019 node scripts/send-wecom-links-batch.mjs [--dry-run]
// 绑定规则: staff_master_raw.json 中 userid = 'm' + 电话
import fs from 'fs';
import path from 'path';
import { DATA_DIR, RAW_DIR, SCRIPTS_DIR } from './config.mjs';

const CORPID = process.env.WECOM_CORPID;
const CORPSECRET = process.env.WECOM_CORPSECRET;
const AGENTID = process.env.WECOM_AGENTID || '1000019';
const BASE = 'https://qyapi.weixin.qq.com/cgi-bin';
// 看板基址：与 parse-data-v2.mjs 的 LINKS_BASE 保持同一环境变量，默认新域名
const DASHBOARD = process.env.STORE_OPS_LINKS_BASE || 'https://operational-enablement.linkduoo.com/';
const DRY = process.argv.includes('--dry-run');

if (!DRY && (!CORPID || !CORPSECRET)) {
  console.error('❌ 缺少 WECOM_CORPID / WECOM_CORPSECRET 环境变量（或加 --dry-run 仅预览）');
  process.exit(1);
}

// 店员主数据优先取 raw/（每日刷新），回退 scripts/（历史位置）
const staffPath = [path.join(RAW_DIR, 'staff_master_raw.json'), path.join(SCRIPTS_DIR, 'staff_master_raw.json')]
  .find((p) => fs.existsSync(p));
if (!staffPath) { console.error('❌ 找不到 staff_master_raw.json（已查 raw/ 与 scripts/）'); process.exit(1); }

const version = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'version.json'), 'utf-8'));
const staff = JSON.parse(fs.readFileSync(staffPath, 'utf-8'));
const f = staff.data.fields;
const iTel = f.indexOf('电话');
const iName = f.indexOf('【标准】店员名字');

const bind = {};
for (const r of staff.data.data) {
  const name = (Array.isArray(r[iName]) ? r[iName].map(x => x.text || x).join('') : r[iName]) || '';
  const tel = r[iTel];
  if (name && tel) bind[String(name).trim()] = 'm' + String(tel).trim();
}

async function getToken() {
  const r = await fetch(`${BASE}/gettoken?corpid=${CORPID}&corpsecret=${CORPSECRET}`);
  const d = await r.json();
  if (d.errcode !== 0) throw new Error(`获取 token 失败: ${JSON.stringify(d)}`);
  return d.access_token;
}

async function send(token, userid, content) {
  const r = await fetch(`${BASE}/message/send?access_token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ touser: userid, msgtype: 'text', agentid: Number(AGENTID), text: { content } }),
  });
  return r.json();
}

async function main() {
  const ok = [], fail = [], unbound = [];
  const token = DRY ? null : await getToken();
  for (const name of version.users) {
    const userid = bind[name];
    if (!userid) { unbound.push(name); console.log(`⚪ ${name}: 无企微绑定，跳过`); continue; }
    const link = DASHBOARD + '?id=' + encodeURIComponent(name);
    const content = `【门店运营看板】${name}，您本期数据已更新（销售业绩、提成、达成率、客户回访清单），点击查看 👉 ${link}`;
    if (DRY) { console.log(`🔍 [dry-run] ${name} → ${userid}\n   ${link}`); ok.push(name); continue; }
    try {
      const res = await send(token, userid, content);
      if (res.errcode === 0) {
        if (res.invaliduser) { fail.push(`${name}(invaliduser:${res.invaliduser})`); console.log(`❌ ${name} → ${userid}: 无效用户`); }
        else { ok.push(name); console.log(`✅ ${name} → ${userid}`); }
      } else { fail.push(`${name}(${res.errcode}:${res.errmsg})`); console.log(`❌ ${name} → ${userid}: ${res.errcode} ${res.errmsg}`); }
    } catch (e) { fail.push(`${name}(${e.message})`); console.log(`❌ ${name}: ${e.message}`); }
    await new Promise(r => setTimeout(r, 300)); // 限速
  }
  console.log(`\n══ 推送汇总 ══\n成功 ${ok.length}: ${ok.join('、') || '-'}\n失败 ${fail.length}: ${fail.join('、') || '-'}\n未绑定 ${unbound.length}: ${unbound.join('、') || '-'}`);
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
