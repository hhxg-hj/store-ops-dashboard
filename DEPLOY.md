# 门店运营数据看板 · 阿里云部署运维手册

> 版本：v1.0 | 更新日期：2026-07-31
> 目标：将 `deploy/` 目录（index.html + data/*.json）部署到阿里云 OSS + CDN，Codeup push 触发自动更新

---

## 一、前置准备（运维手动完成，约 30 分钟）

### 1.1 创建 OSS Bucket（静态网站托管）

1. 登录 [阿里云 OSS 控制台](https://oss.console.aliyun.com/)
2. 创建 Bucket：
   - **Bucket 名称**：`store-ops-dashboard`（或自定义，全局唯一）
   - **地域**：`oss-cn-chengdu`（成都，与业务最近）
   - **存储类型**：标准存储
   - **读写权限**：**公共读**（静态网站必须）
   - **版本控制**：关闭
3. 进入 Bucket → **基础设置** → **静态页面**：
   - **默认首页**：`index.html`
   - **默认 404 页**：`index.html`（SPA 路由兼容）
4. 记录 **Bucket 域名**：
   - 外网访问域名：`https://store-ops-dashboard.oss-cn-chengdu.aliyuncs.com`
   - 内网访问域名（ECS 用）：`https://store-ops-dashboard.oss-cn-chengdu-internal.aliyuncs.com`

### 1.2 创建 CDN 加速域名

1. 登录 [阿里云 CDN 控制台](https://cdn.console.aliyun.com/)
2. 添加加速域名：
   - **加速域名**：`dashboard.example.com`（替换为实际域名）
   - **业务类型**：网页加速
   - **源站信息**：
     - **源站类型**：OSS 域名
     - **OSS 域名**：`store-ops-dashboard.oss-cn-chengdu.aliyuncs.com`
     - **回源 HOST**：`store-ops-dashboard.oss-cn-chengdu.aliyuncs.com`
   - **加速区域**：仅中国内地（或全球，按需）
3. 进入域名管理 → **缓存配置**：
   - **缓存过期时间**：
     - `*.html`：0 秒（不缓存，保证实时性）
     - `*.json`：0 秒（不缓存，数据实时更新）
     - `*.js / *.css / *.png / *.jpg / *.mp4`：30 天（静态资源长缓存）
4. 进入域名管理 → **HTTPS 配置**：
   - 开启 HTTPS 安全加速
   - 上传 SSL 证书（或申请免费证书）
5. 记录 **CDN 域名 ID**（在域名管理页面查看，用于流水线刷新缓存）

### 1.3 创建 RAM 子账号（流水线专用）

1. 登录 [RAM 控制台](https://ram.console.aliyun.com/)
2. 创建用户：
   - **登录名称**：`store-ops-pipeline`
   - **访问方式**：OpenAPI 调用访问（勾选）
3. 记录 **AccessKey ID** 和 **AccessKey Secret**（只显示一次，务必保存）
4. 为该用户授权：
   - **权限策略 1**：`AliyunOSSFullAccess`（OSS 读写）
   - **权限策略 2**：`AliyunCDNFullAccess`（CDN 刷新）
   - （可选，更安全）自定义策略，只允许操作指定 Bucket 和 CDN 域名：
     ```json
     {
       "Version": "1",
       "Statement": [
         {
           "Effect": "Allow",
           "Action": ["oss:*"],
           "Resource": [
             "acs:oss:*:*:store-ops-dashboard",
             "acs:oss:*:*:store-ops-dashboard/*"
           ]
         },
         {
           "Effect": "Allow",
           "Action": ["cdn:RefreshObjectCaches", "cdn:DescribeRefreshTasks"],
           "Resource": "*"
         }
       ]
     }
     ```

### 1.4 上传视频/图片/文档到 OSS（**可选，验证通过后再执行**，约 10 分钟）

> **建议**：先跳过本步骤，直接执行「二、Codeup 流水线配置」并验证部署成功。确认看板能正常访问后，再回来上传视频/图片/文档。

**方式 A：OSS 控制台上传（推荐，适合文件少）**

1. 进入 Bucket → **文件管理** → **文件列表**
2. 创建目录 `products/`
3. 上传以下 21 个文件（从仓库 `assets/products/` 目录）：
   - `nestle-quanhua-a2-onepager.jpg`
   - `nestle-quanhua-a2-poster.jpg`
   - `nestle-quanhua-a2-test.docx`
   - `nestle-quanhua-a2-video.mp4`
   - `zhenhu-goat-onepager.jpg`
   - `zhenhu-goat-poster.jpg`
   - `zhenhu-goat-test.xlsx`
   - `zhenhu-goat-video.mp4`
   - `zhenhu-platinum-onepager.jpg`
   - `zhenhu-platinum-poster.jpg`
   - `zhenhu-platinum-test.xlsx`
   - `zhenhu-platinum-video.mp4`
   - `zhenhu-royal-a2-onepager.jpg`
   - `zhenhu-royal-a2-poster.jpg`
   - `zhenhu-royal-a2-test.xlsx`
   - `zhenhu-royal-a2-video.mp4`
   - `zhenhu-supreme-a2-onepager.jpg`
   - `zhenhu-supreme-a2-poster.jpg`
   - `zhenhu-supreme-a2-test.xlsx`
   - `zhenhu-supreme-a2-video.mp4`

**方式 B：ossutil 命令行批量上传（适合文件多）**

```bash
# 1. 下载 ossutil
wget https://gosspublic.alicdn.com/ossutil/1.7.14/ossutil64 -O /usr/local/bin/ossutil
chmod +x /usr/local/bin/ossutil

# 2. 配置凭证
ossutil config -e oss-cn-chengdu.aliyuncs.com -i <AccessKey ID> -k <AccessKey Secret>

# 3. 批量上传（从仓库根目录执行）
ossutil cp -r deploy/assets/products/ oss://store-ops-dashboard/products/ --update
```

**验证上传成功**：

```bash
# 访问任意文件，确认返回 200
curl -I https://store-ops-dashboard.oss-cn-chengdu.aliyuncs.com/products/nestle-quanhua-a2-video.mp4
```

### 1.5 更新 manifest.json（**可选，与 1.4 一起执行**）

> **建议**：如果跳过了 1.4，本步骤也跳过。当前 `manifest.json` 里的 OSS 地址是模板，parse 脚本会回退到飞书链接（有权限限制，但看板主功能不受影响）。

上传完成后，修改仓库 `deploy/assets/manifest.json`，将路径改为 OSS 绝对地址：

```json
{
  "全护A2": {
    "onepager": "https://store-ops-dashboard.oss-cn-chengdu.aliyuncs.com/products/nestle-quanhua-a2-onepager.jpg",
    "poster": "https://store-ops-dashboard.oss-cn-chengdu.aliyuncs.com/products/nestle-quanhua-a2-poster.jpg",
    "test": "https://store-ops-dashboard.oss-cn-chengdu.aliyuncs.com/products/nestle-quanhua-a2-test.docx",
    "video": "https://store-ops-dashboard.oss-cn-chengdu.aliyuncs.com/products/nestle-quanhua-a2-video.mp4"
  },
  "羊奶": { ... },
  "铂金": { ... },
  "皇家A2": { ... },
  "至尊A2": { ... }
}
```

**注意**：`manifest.json` 不需要上传到 OSS，它被打包在 index.html 里（parse 脚本会内联读取）。

---

## 二、Codeup 流水线配置（约 15 分钟）

### 2.1 配置环境变量

1. 登录 [云效 Flow](https://flow.aliyun.com/)
2. 进入流水线 → **环境变量** → **添加变量**：

| 变量名 | 变量值 | 是否保密 | 说明 |
|---|---|---|---|
| `ALIYUN_ACCESS_KEY_ID` | `<RAM 子账号 AccessKey ID>` | ✅ 是 | 流水线访问 OSS/CDN 的凭证 |
| `ALIYUN_ACCESS_KEY_SECRET` | `<RAM 子账号 AccessKey Secret>` | ✅ 是 | 同上 |
| `OSS_BUCKET` | `store-ops-dashboard` | 否 | OSS Bucket 名称 |
| `OSS_REGION` | `oss-cn-chengdu` | 否 | OSS 地域 |
| `CDN_ID` | `<CDN 域名 ID>` | 否 | CDN 域名 ID（在 CDN 控制台域名管理页面查看） |
| `DEPLOY_DIR` | `deploy` | 否 | 部署目录（仓库中的 deploy/） |

**保密变量**（勾选"保密"）在流水线日志中不会显示明文，安全可靠。

### 2.2 创建流水线

1. 云效 Flow → **新建流水线**
2. 选择 **空白模板**
3. **流水线源**：
   - **代码源**：Codeup
   - **代码仓库**：`operational_enablement`
   - **默认分支**：`main`
   - **触发方式**：**代码提交触发**（push 到 main 分支自动触发）
4. **阶段 1：构建**
   - **阶段名称**：`构建`
   - **任务名称**：`检查文件`
   - **构建集群**：`默认集群`（或北京/上海，按需）
   - **构建步骤**：
     ```yaml
     - step: Command
       name: 检查部署文件
       run: |
         echo "=== 检查 deploy/ 目录 ==="
         ls -lh deploy/
         echo "=== 检查 index.html 大小 ==="
         du -sh deploy/index.html
         echo "=== 检查 data/ 文件数 ==="
         ls deploy/data/ | wc -l
         echo "=== 检查 assets/ 是否含 mp4（应为 0）==="
         find deploy/assets -name "*.mp4" | wc -l || echo "0"
     ```
5. **阶段 2：部署**
   - **阶段名称**：`部署到 OSS`
   - **任务名称**：`上传 OSS + 刷新 CDN`
   - **构建步骤**：
     ```yaml
     - step: Command
       name: 安装 ossutil
       run: |
         wget https://gosspublic.alicdn.com/ossutil/1.7.14/ossutil64 -O /tmp/ossutil
         chmod +x /tmp/ossutil
         /tmp/ossutil config -e ${OSS_REGION}.aliyuncs.com -i ${ALIYUN_ACCESS_KEY_ID} -k ${ALIYUN_ACCESS_KEY_SECRET}

     - step: Command
       name: 上传 index.html 和 data/
       run: |
         # 上传 index.html（不缓存）
         /tmp/ossutil cp deploy/index.html oss://${OSS_BUCKET}/index.html \
           --meta "Cache-Control:no-cache, no-store, must-revalidate" \
           --update

         # 上传 data/*.json（不缓存）
         /tmp/ossutil cp -r deploy/data/ oss://${OSS_BUCKET}/data/ \
           --include "*.json" \
           --meta "Cache-Control:no-cache, no-store, must-revalidate" \
           --update

         # 上传 assets/manifest.json（不缓存，parse 脚本内联读取）
         /tmp/ossutil cp deploy/assets/manifest.json oss://${OSS_BUCKET}/assets/manifest.json \
           --meta "Cache-Control:no-cache, no-store, must-revalidate" \
           --update

     - step: Command
       name: 刷新 CDN 缓存
       run: |
         # 安装 aliyun CLI
         wget https://aliyuncli.alicdn.com/aliyun-cli-linux-latest-amd64.tgz -O /tmp/aliyun.tgz
         tar -xzf /tmp/aliyun.tgz -C /tmp/
         /tmp/aliyun configure set \
           --mode AK \
           --access-key-id ${ALIYUN_ACCESS_KEY_ID} \
           --access-key-secret ${ALIYUN_ACCESS_KEY_SECRET} \
           --region cn-chengdu

         # 刷新 CDN（刷新整个域名）
         /tmp/aliyun cdn RefreshObjectCaches \
           --DomainId ${CDN_ID} \
           --ObjectType Directory \
           --ObjectPath "https://dashboard.example.com/"

         echo "✅ CDN 刷新任务已提交，约 5 分钟生效"
     ```
6. **保存并启用流水线**

### 2.3 验证流水线

1. 手动触发一次流水线（云效 Flow → 流水线 → **运行**）
2. 查看构建日志，确认：
   - ✅ 检查文件阶段：`deploy/` 目录存在，`data/` 有 25 个 JSON
   - ✅ 上传 OSS 阶段：`index.html` / `data/*.json` / `assets/manifest.json` 上传成功
   - ✅ 刷新 CDN 阶段：CDN 刷新任务提交成功
3. 访问 CDN 域名验证：
   - `https://dashboard.example.com/` → 应看到看板首页
   - `https://dashboard.example.com/data/詹芹芹.json` → 应返回 JSON 数据
   - `https://dashboard.example.com/assets/manifest.json` → 应返回 manifest

---

## 三、环境变量速查表

| 变量名 | 示例值 | 说明 |
|---|---|---|
| `ALIYUN_ACCESS_KEY_ID` | `LTAI5tXXXXXXXXXXXXXX` | RAM 子账号 AccessKey ID |
| `ALIYUN_ACCESS_KEY_SECRET` | `XXXXXXXXXXXXXXXXXXXXXXXX` | RAM 子账号 AccessKey Secret |
| `OSS_BUCKET` | `store-ops-dashboard` | OSS Bucket 名称（全局唯一） |
| `OSS_REGION` | `oss-cn-chengdu` | OSS 地域（成都） |
| `CDN_ID` | `1234567890` | CDN 域名 ID（在 CDN 控制台查看） |
| `DEPLOY_DIR` | `deploy` | 部署目录（仓库中的 deploy/） |

---

## 四、常见故障排查

### 4.1 流水线失败：`ossutil: command not found`

**原因**：ossutil 下载失败或路径不对

**解决**：
- 检查 `wget` 是否成功（看构建日志）
- 手动下载 ossutil 到流水线工作目录：`wget https://gosspublic.alicdn.com/ossutil/1.7.14/ossutil64 -O ./ossutil`

### 4.2 流水线失败：`Error: AccessDenied`

**原因**：RAM 子账号权限不足

**解决**：
- 检查 RAM 子账号是否有 `AliyunOSSFullAccess` 和 `AliyunCDNFullAccess` 权限
- 检查环境变量 `ALIYUN_ACCESS_KEY_ID` 和 `ALIYUN_ACCESS_KEY_SECRET` 是否正确

### 4.3 部署后访问 404

**原因**：OSS 静态网站托管未配置默认首页

**解决**：
- 进入 OSS Bucket → **基础设置** → **静态页面** → 设置默认首页为 `index.html`

### 4.4 部署后数据不更新

**原因**：CDN 缓存未刷新

**解决**：
- 检查流水线「刷新 CDN」阶段是否成功
- 手动在 CDN 控制台刷新：域名管理 → 刷新预热 → 提交刷新任务
- 检查 `index.html` 和 `data/*.json` 的 `Cache-Control` 头是否为 `no-cache`

### 4.5 视频无法播放

**原因**：视频文件未上传到 OSS，或 `manifest.json` 里的路径不对

**解决**：
- 检查 OSS Bucket 的 `products/` 目录是否有 5 个 mp4 文件
- 检查 `deploy/assets/manifest.json` 里的 `video` 字段是否为 OSS 绝对地址
- 访问视频 URL 验证：`curl -I https://store-ops-dashboard.oss-cn-chengdu.aliyuncs.com/products/nestle-quanhua-a2-video.mp4`

---

## 五、阶段二扩展（预留）

当前流水线只部署静态产物（index.html + data/*.json）。未来如需把**数据管线**（飞书拉数 + parse 生成 JSON）搬上云，可按以下扩展：

1. **新增阶段 0：数据生成**
   - 在云效 Flow 或函数计算 FC 上跑 `fetch-feishu.mjs` + `parse-data-v2.mjs`
   - 定时触发（每天 8:00 / 12:00 / 18:00）
   - 需要额外环境变量：
     - `FEISHU_APP_ID` / `FEISHU_APP_SECRET`（飞书应用凭证）
     - `FEISHU_BASE_TOKEN`（飞书多维表格 token）
     - `STORE_OPS_TODAY`（可选，指定"当日"日期）

2. **数据生成产物直接写 OSS**
   - parse 脚本输出目录改为 OSS 路径（通过 ossutil 上传）
   - 无需 git commit，流水线只负责数据生成 + 上传

3. **成本估算**
   - 函数计算 FC：按调用次数计费，每天 3 次约 ¥0.01/月
   - OSS 存储：25 个 JSON + 5 个视频约 250MB，约 ¥0.03/月
   - CDN 流量：按实际访问量计费，约 ¥0.24/GB

---

## 六、联系与支持

- **仓库地址**：https://codeup.aliyun.com/665d1a7e2fb15289e0e9f8fd/operational_enablement
- **流水线地址**：（运维配置后填写）
- **CDN 域名**：（运维配置后填写）
- **OSS Bucket**：`store-ops-dashboard`（或实际名称）

**文档维护**：本文档由 `store-ops-expert` 专家包维护，如有变更请同步更新。
