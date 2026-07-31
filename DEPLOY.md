# 门店运营数据看板 · 部署运维手册

> 版本：v2.0 | 更新日期：2026-07-31
> 目标：将整个 `deploy/` 目录（index.html + data/*.json + assets/）部署到任意静态文件服务器，运维自行选择部署方式

---

## 一、仓库产物说明

本仓库为**纯静态文件**，无需构建，直接部署即可。

| 目录/文件 | 大小 | 说明 |
|---|---|---|
| `index.html` | ~88KB | 看板主页面（单文件应用，所有逻辑内联） |
| `data/*.json` | ~1.7MB | 23 份店员数据 + 2 份汇总数据（version.json / index.json） |
| `assets/products/` | ~230MB | 产品学习资源（5 个视频 + 15 个图片/文档） |
| `assets/manifest.json` | ~2KB | 产品资源清单（parse 脚本内联读取） |
| `assets/_raw_videos/` | ~1.5GB | 原始视频（**不入库**，已被 .gitignore 排除） |

**总计**：约 232MB（不含 _raw_videos）

---

## 二、环境变量清单

**无需环境变量**。本仓库为纯静态文件，部署时无需配置任何环境变量。

---

## 三、部署方式（运维自行选择）

### 方式 A：Nginx / Apache 静态文件服务

1. 将整个 `deploy/` 目录上传到服务器（如 `/var/www/dashboard/`）
2. Nginx 配置示例：
   ```nginx
   server {
       listen 80;
       server_name dashboard.example.com;
       root /var/www/dashboard;
       index index.html;

       location / {
           try_files $uri $uri/ /index.html;  # SPA 路由兼容
       }

       # 视频/图片/文档长缓存
       location ~* \.(mp4|jpg|png|docx|xlsx)$ {
           expires 30d;
           add_header Cache-Control "public, immutable";
       }

       # HTML/JSON 不缓存
       location ~* \.(html|json)$ {
           expires 0;
           add_header Cache-Control "no-cache, no-store, must-revalidate";
       }
   }
   ```
3. 重启 Nginx：`sudo nginx -s reload`

### 方式 B：OSS 静态网站托管（阿里云）

1. 创建 OSS Bucket（公共读，静态网站托管）
2. 上传整个 `deploy/` 目录（ossutil 或控制台）
3. 绑定 CDN 加速域名（可选）
4. 参考：[阿里云 OSS 静态网站托管文档](https://help.aliyun.com/zh/oss/user-guide/static-website-hosting)

### 方式 C：Vercel / Netlify / GitHub Pages

1. 连接 Git 仓库
2. 构建命令：留空（无需构建）
3. 输出目录：`deploy`
4. 部署即可

### 方式 D：Docker 容器

1. 创建 `Dockerfile`：
   ```dockerfile
   FROM nginx:alpine
   COPY deploy/ /usr/share/nginx/html/
   EXPOSE 80
   ```
2. 构建镜像：`docker build -t store-ops-dashboard .`
3. 运行容器：`docker run -d -p 80:80 store-ops-dashboard`

---

## 四、访问路径

部署后访问路径为**根目录**，资源引用均为相对路径：

- 看板首页：`https://dashboard.example.com/`
- 店员数据：`https://dashboard.example.com/data/詹芹芹.json`
- 产品视频：`https://dashboard.example.com/assets/products/nestle-quanhua-a2-video.mp4`

**注意**：index.html 里的资源引用已使用相对路径 `./assets/products/...`，无需配置 base path。

---

## 五、更新流程

1. 本地修改代码/数据
2. `git commit` + `git push` 到 Codeup
3. 运维手动拉取最新代码并重新部署（或配置 Webhook 自动部署）

**建议**：运维可配置 Webhook，push 后自动执行：
```bash
cd /var/www/dashboard
git pull origin main
sudo nginx -s reload  # 或重启其他 Web 服务器
```

---

## 六、常见故障排查

### 6.1 访问 404

**原因**：Web 服务器未配置默认首页或 SPA 路由兼容

**解决**：
- Nginx：确认 `index index.html;` 和 `try_files $uri $uri/ /index.html;` 已配置
- Apache：确认 `.htaccess` 有 `DirectoryIndex index.html` 和 `FallbackResource /index.html`

### 6.2 视频无法播放

**原因**：视频文件路径不对或 MIME 类型未配置

**解决**：
- 检查视频文件是否存在：`ls deploy/assets/products/*.mp4`
- Nginx 配置 MIME 类型：
  ```nginx
  types {
      video/mp4 mp4;
      image/jpeg jpg jpeg;
      application/vnd.openxmlformats-officedocument.wordprocessingml.document docx;
      application/vnd.openxmlformats-officedocument.spreadsheetml.sheet xlsx;
  }
  ```

### 6.3 数据不更新

**原因**：浏览器缓存或 CDN 缓存

**解决**：
- 强制刷新浏览器缓存（Ctrl+Shift+R）
- 检查 index.html 和 data/*.json 的响应头是否为 `Cache-Control: no-cache`
- 如使用 CDN，手动刷新 CDN 缓存

---

## 七、联系与支持

- **仓库地址**：https://codeup.aliyun.com/665d1a7e2fb15289e0e9f8fd/operational_enablement
- **部署方式**：运维自行选择（Nginx / OSS / Vercel / Docker 等）
- **环境变量**：无需配置

**文档维护**：本文档由 `store-ops-expert` 专家包维护，如有变更请同步更新。
