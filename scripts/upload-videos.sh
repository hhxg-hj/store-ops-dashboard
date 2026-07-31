#!/bin/bash
# upload-videos.sh — 一次性上传产品视频/图片/文档到 OSS
# 用法：./scripts/upload-videos.sh
# 前提：已安装 ossutil 并配置凭证（ossutil config）

set -e

# 从环境变量读取配置（或手动修改以下默认值）
OSS_BUCKET=${OSS_BUCKET:-"store-ops-dashboard"}
OSS_REGION=${OSS_REGION:-"oss-cn-chengdu"}
LOCAL_DIR=${LOCAL_DIR:-"deploy/assets/products"}

echo "=== 上传产品资源到 OSS ==="
echo "Bucket: $OSS_BUCKET"
echo "Region: $OSS_REGION"
echo "Local:  $LOCAL_DIR"
echo ""

# 检查 ossutil
if ! command -v ossutil &> /dev/null; then
    echo "❌ ossutil 未安装"
    echo "下载：wget https://gosspublic.alicdn.com/ossutil/1.7.14/ossutil64 -O /usr/local/bin/ossutil"
    echo "配置：ossutil config -e ${OSS_REGION}.aliyuncs.com -i <AccessKey ID> -k <AccessKey Secret>"
    exit 1
fi

# 检查本地目录
if [ ! -d "$LOCAL_DIR" ]; then
    echo "❌ 本地目录不存在：$LOCAL_DIR"
    exit 1
fi

# 上传 products/ 目录下所有文件
echo "开始上传..."
ossutil cp -r "$LOCAL_DIR/" "oss://${OSS_BUCKET}/products/" --update

echo ""
echo "✅ 上传完成"
echo ""
echo "验证上传："
echo "  curl -I https://${OSS_BUCKET}.${OSS_REGION}.aliyuncs.com/products/nestle-quanhua-a2-video.mp4"
echo ""
echo "下一步："
echo "  1. 修改 deploy/assets/manifest.json，将路径改为 OSS 绝对地址"
echo "  2. 重新跑 parse-data-v2.mjs 生成店员 JSON"
echo "  3. git commit + push 触发流水线部署"
