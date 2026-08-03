// send-wecom-links.mjs — 通过企微自建应用「销售助手」API 提取接收人 userid 并推送店员看板链接
// 用法: WECOM_CORPID=xxx WECOM_CORPSECRET=xxx WECOM_AGENTID=1000019 node scripts/send-wecom-links.mjs <接收人姓名> [店员名]
// 凭证仅从环境变量读取，不写入任何文件。
import process from 'process';

const CORPID = process.env.WECOM_CORPID;
const CORPSECRET = process.env.WECOM_CORPSECRET;
const AGENTID = process.env.WECOM_AGENTID;
const BASE = 'https://qyapi.weixin.qq.com/cgi-bin';

const recipient = process.argv[2];      // 接收链接的企微用户姓名，如 陈泓吉
const clerk = process.argv[3] || '詹芹芹'; // 要推送的店员（任意一个）
const DASHBOARD = 'https://hhxg-hj.github.io/store-ops-dashboard/';

if (!CORPID || !CORPSECRET || !AGENTID) {
  console.error('❌ 缺少 WECOM_CORPID / WECOM_CORPSECRET / WECOM_AGENTID 环境变量');
  process.exit(1);
}
if (!recipient) {
  console.error('❌ 用法: node scripts/send-wecom-links.mjs <接收人姓名> [店员名]');
  process.exit(1);
}

async function getToken() {
  const url = `${BASE}/gettoken?corpid=${CORPID}&corpsecret=${CORPSECRET}`;
  const r = await fetch(url);
  const d = await r.json();
  if (d.errcode !== 0) throw new Error(`获取 token 失败: ${JSON.stringify(d)}`);
  return d.access_token;
}

// 从通讯录提取 userid（根部门递归拉全量，本地按姓名过滤）
async function findUserid(token, name) {
  const url = `${BASE}/user/simplelist?access_token=${token}&department_id=1&fetch_child=1`;
  const r = await fetch(url);
  const d = await r.json();
  if (d.errcode !== 0) throw new Error(`拉取通讯录失败: ${JSON.stringify(d)}`);
  const list = d.userlist || [];
  const matches = list.filter(u => u.name === name || (u.name || '').includes(name) || (u.alias || '') === name);
  return matches;
}

async function send(token, userid, content) {
  const url = `${BASE}/message/send?access_token=${token}`;
  const body = {
    touser: userid,
    msgtype: 'text',
    agentid: Number(AGENTID),
    text: { content },
  };
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.json();
}

async function main() {
  console.log(`[1/3] 获取企微 access_token...`);
  const token = await getToken();
  console.log('  token OK');

  console.log(`[2/3] 通讯录提取「${recipient}」...`);
  const matches = await findUserid(token, recipient);
  if (matches.length === 0) {
    console.error(`❌ 通讯录中未找到「${recipient}」`);
    process.exit(1);
  }
  if (matches.length > 1) {
    console.error(`⚠️ 找到多个匹配，请确认：`, matches.map(m => `${m.name}(${m.userid})`).join(' | '));
    process.exit(1);
  }
  const target = matches[0];
  console.log(`  命中: ${target.name} → userid=${target.userid}`);

  const link = DASHBOARD + '?id=' + encodeURIComponent(clerk);
  const content = `【门店运营看板】${clerk}，您本期数据已更新（销售业绩、提成、达成率、客户回访清单），点击查看 👉 ${link}`;

  console.log(`[3/3] 通过「销售助手」(agentid=${AGENTID}) 推送链接给 ${target.name}...`);
  const res = await send(token, target.userid, content);
  if (res.errcode !== 0) throw new Error(`发送失败: ${JSON.stringify(res)}`);
  console.log(`✅ 已发送给 ${target.name}（userid=${target.userid}）`);
  console.log(`🔗 链接: ${link}`);
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
