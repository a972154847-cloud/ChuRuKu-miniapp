#!/bin/bash
# =============================================================================
# 器材装备管理小程序 - PVE 一键部署脚本
# 在 PVE 的 LXC 容器或 VM 中执行（推荐 Debian 12 / Ubuntu 22.04+）
# 用法：
#   chmod +x deploy-pve.sh && ./deploy-pve.sh
# =============================================================================
set -euo pipefail

DOMAIN="pve.972154847.asia"
PROJECT_DIR="/opt/equipment-manager"

echo "========================================"
echo " 器材装备管理小程序 - PVE 部署"
echo "========================================"

# ------ 1. 安装 Docker + Nginx + certbot ------
echo "[1/7] 安装 Docker、Nginx 和 certbot..."
apt update -y
apt install -y curl gnupg lsb-release nginx certbot python3-certbot-nginx

# Docker 官方源安装
if ! command -v docker &>/dev/null; then
  curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/debian $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
  apt update -y
  apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
fi

# ------ 2. 创建项目目录并部署文件 ------
echo "[2/7] 创建项目目录..."
mkdir -p ${PROJECT_DIR}
cd ${PROJECT_DIR}

echo "[3/7] 克隆项目代码..."
# ⚠️ 如果没有 git 仓库，请先 scp 上传到 PVE，或改用下面命令手动上传
# 如果有 git 仓库，取消注释下面这行并替换为你的仓库地址
# git clone https://github.com/your-org/equipment-manager.git .

# 提示用户上传代码
echo "⚠️  请将本地项目文件上传到 ${PROJECT_DIR}"
echo "   在 Windows 上执行（替换路径）:"
echo "   scp -r C:/Users/SongYuanXinTong/Documents/trae_projects/器材装备管理小程序/* root@${DOMAIN}:${PROJECT_DIR}/"

# ------ 3. 启动后端（Docker Compose） ------
echo "[4/7] 启动后端 Docker 服务..."
docker compose up -d --build

# 等待健康检查
echo "      等待后端启动..."
for i in $(seq 1 15); do
  if curl -s http://localhost:3000/api/health >/dev/null 2>&1; then
    echo "      后端已就绪 ✓"
    break
  fi
  sleep 2
done

# ------ 4. 配置 HTTPS 证书（Let's Encrypt） ------
echo "[5/7] 申请 HTTPS 证书..."
# 先启动一个临时 nginx 用于 certbot 验证
# 因为正式 nginx 配置需要证书，而证书又需要 nginx 验证，先用 standalone 模式
certbot certonly --standalone -d ${DOMAIN} --non-interactive --agree-tos --email admin@${DOMAIN#*.} || true

# 检查证书是否成功
if [ ! -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]; then
  echo "⚠️  证书申请失败，请手动运行："
  echo "   certbot --nginx -d ${DOMAIN}"
  echo "   或者检查域名 ${DOMAIN} 是否解析到本机 IP"
else
  echo "      证书已获取 ✓"
fi

# ------ 5. 配置 Nginx 反向代理 ------
echo "[6/7] 配置 Nginx 反向代理..."

# 复制 nginx 配置
cp ${PROJECT_DIR}/deploy/nginx.conf /etc/nginx/sites-available/${DOMAIN}

# 如果证书还没好，用 self-signed 临时兜底
if [ ! -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]; then
  echo "      证书未就绪，生成临时自签名证书..."
  mkdir -p /etc/nginx/ssl
  openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout /etc/nginx/ssl/${DOMAIN}.key \
    -out /etc/nginx/ssl/${DOMAIN}.crt \
    -subj "/CN=${DOMAIN}"
  # 修改 nginx 配置指向临时证书
  sed -i "s|/etc/letsencrypt/live/${DOMAIN}/fullchain.pem|/etc/nginx/ssl/${DOMAIN}.crt|g" /etc/nginx/sites-available/${DOMAIN}
  sed -i "s|/etc/letsencrypt/live/${DOMAIN}/privkey.pem|/etc/nginx/ssl/${DOMAIN}.key|g" /etc/nginx/sites-available/${DOMAIN}
fi

ln -sf /etc/nginx/sites-available/${DOMAIN} /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

# 测试并重载
nginx -t && systemctl reload nginx
echo "      Nginx 配置完成 ✓"

# ------ 6. 设置自动续签 ------
echo "[7/7] 配置证书自动续签..."
# certbot 安装时已自动添加 systemd timer
systemctl enable certbot.timer 2>/dev/null || true
# 添加续签后 reload nginx 的 hook
mkdir -p /etc/letsencrypt/renewal-hooks/post
cat > /etc/letsencrypt/renewal-hooks/post/reload-nginx.sh << 'EOF'
#!/bin/sh
systemctl reload nginx
EOF
chmod +x /etc/letsencrypt/renewal-hooks/post/reload-nginx.sh
echo "      自动续签已配置 ✓"

# ------ 完成 ------
echo ""
echo "========================================"
echo " ✅ 部署完成！"
echo "========================================"
echo ""
echo "后端 API:     https://${DOMAIN}/api/health"
echo "Nginx 配置:   /etc/nginx/sites-available/${DOMAIN}"
echo "项目目录:     ${PROJECT_DIR}"
echo ""
echo "查看后端日志: docker compose logs -f backend"
echo ""
echo "下一步："
echo "1. 微信公众平台 -> 开发 -> 开发设置 -> 服务器域名"
echo "   添加 request:   https://${DOMAIN}"
echo "   添加 uploadFile: https://${DOMAIN}"
echo "   添加 downloadFile: https://${DOMAIN}"
echo ""
echo "2. 在本地 Windows 构建前端并上传："
echo "   cd frontend"
echo '   $env:NODE_ENV="production"; npm run build:weapp'
echo "   微信开发者工具 -> 上传 -> 提交审核"
echo ""
