// pull-all-trades-cli.mjs — 用 lark-cli 分页拉取全量成交明细
import { execSync } from 'child_process';
import fs from 'fs';

const BASE = 'WFrkb7zn1aZV8gsTcrtcAvSZnzh';
const TABLE = 'tblj7Vw6nKzNp4xf';

// First pull to get metadata
const first = execSync(`lark-cli base +record-list --base-token ${BASE} --table-id ${TABLE} --as user --limit 200 --json 2>/dev/null`, { encoding: 'utf-8', maxBuffer: 50*1024*1024 });
const firstData = JSON.parse(first);
const fields = firstData.data.fields;
const allRows = [...firstData.data.data];
console.log(`page 1: ${allRows.length} rows`);

// Now pull remaining pages via the raw API
// We need the page_token from the response
// Use a simple offset approach since lark-cli supports --offset
let offset = 200;
let page = 2;

while (true) {
  try {
    const cmd = `lark-cli base +record-list --base-token ${BASE} --table-id ${TABLE} --as user --limit 200 --json --offset ${offset} 2>/dev/null`;
    const stdout = execSync(cmd, { encoding: 'utf-8', maxBuffer: 50*1024*1024, timeout: 60000 });
    const d = JSON.parse(stdout);
    
    if (!d.ok || !d.data?.data?.length) break;
    
    allRows.push(...d.data.data);
    console.log(`page ${page}: ${d.data.data.length} rows (total ${allRows.length}), has_more=${d.data.has_more}`);
    
    if (!d.data.has_more) break;
    offset += 200;
    page++;
  } catch (e) {
    console.log(`page ${page} error: ${e.message}`);
    break;
  }
}

const output = { ...firstData, data: { ...firstData.data, data: allRows, has_more: false } };
fs.writeFileSync('C:/Users/ZhuanZ1/WorkBuddy/2026-07-23-15-44-57/scripts/trade_detail_all.json', JSON.stringify(output), 'utf-8');
console.log(`\n✅ ${allRows.length} total records saved`);
