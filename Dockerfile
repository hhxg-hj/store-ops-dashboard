# 门店运营数据看板 - 纯静态部署镜像
# 对应 DEPLOY.md 方式 D：无需构建，nginx 直接托管静态文件
FROM nginx:alpine

# 拷贝全部静态产物（.dockerignore 已排除 .git 和 _raw_videos）
COPY . /usr/share/nginx/html/

# 复制自定义 nginx 配置（SPA 兼容 + 缓存策略 + Range 支持）
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s \
  CMD wget -qO- http://127.0.0.1/ >/dev/null 2>&1 || exit 1
