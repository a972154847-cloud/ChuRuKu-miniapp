# 部署指南

本文档覆盖后端 Docker 部署与前端微信小程序发布两条主线。

- 后端：Node.js 20 + Express 5 + SQLite（better-sqlite3）
- 前端：Taro 4 + React 18，产物为微信小程序（`dist/`）与 H5

---

## 一、后端 Docker Compose 部署

### 1. 前置条件

- Docker Engine >= 20.10
- Docker Compose v2（`docker compose` 子命令）或 v1（`docker-compose`）
- 已准备：微信小程序 AppID/Secret、AI 服务 API Key（可选，缺失时降级）

### 2. 配置环境变量

在项目根目录复制模板并填入真实凭据：

```bash
cp .env.example .env
vi .env
```

关键项说明：

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `JWT_SECRET` | 是 | 生产环境务必改为 ≥32 字符强随机串 |
| `WX_APP_ID` / `WX_APP_SECRET` | 微信登录必填 | 微信公众平台开发设置获取 |
| `WX_SUBSCRIBE_TEMPLATE_ID` | 通知必填 | 微信订阅消息模板 ID，缺失则通知静默跳过 |
| `AI_API_KEY` | AI 识别必填 | 多模态 AI 服务密钥，缺失时降级语义/文字搜索 |
| `DB_PATH` | 是 | 默认 `/app/data/equipment.db`，对应持久卷 |
| `UPLOAD_DIR` | 是 | 默认 `/app/data/uploads`，随数据卷持久化 |

### 3. 构建并启动

```bash
# 构建镜像并后台启动
docker compose up -d --build

# 查看日志
docker compose logs -f backend

# 查看健康状态（healthy 表示服务就绪）
docker ps
```

### 4. 健康检查

服务启动后（约 15s），后端容器内置 healthcheck 探测 `GET /api/health`：

```bash
curl http://localhost:3000/api/health
# 期望: {"code":0,"message":"ok","data":{"status":"up",...}}
```

数据库迁移在 `server.js` 启动时自动执行（`runMigrations()`），无需手动运行 `npm run migrate`。

### 5. 数据持久化与备份

- 数据卷：`backend-data` 映射到容器 `/app/data`
- 包含：SQLite 数据库 `equipment.db` + 上传文件 `uploads/`
- 备份：

```bash
# 备份数据卷到当前目录
docker run --rm -v equipment-backend-data:/data -v $(pwd):/backup alpine \
  tar czf /backup/equipment-data-$(date +%Y%m%d).tar.gz -C /data .
```

- 恢复：

```bash
docker run --rm -v equipment-backend-data:/data -v $(pwd):/backup alpine \
  tar xzf /backup/equipment-data-YYYYMMDD.tar.gz -C /data
```

### 6. 更新与回滚

```bash
# 拉取新代码后重新构建
git pull
docker compose up -d --build

# 回滚到上一版本镜像（若已标记）
docker compose down
# 使用旧镜像启动，或 git checkout <旧tag> 后重新 build
```

### 7. 停止与清理

```bash
# 停止服务（保留数据卷）
docker compose down

# 停止并删除数据卷（数据将丢失，谨慎）
docker compose down -v
```

---

## 二、反向代理（可选）

生产环境建议在前面加 Nginx 反向代理，处理 HTTPS 与域名：

```nginx
server {
    listen 443 ssl;
    server_name your-domain.com;

    ssl_certificate     /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    client_max_body_size 15m;  # 单张照片 ≤5MB，多文件上传预留

    location /api/ {
        proxy_pass http://127.0.0.1:3000/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /uploads/ {
        proxy_pass http://127.0.0.1:3000/uploads/;
    }
}
```

---

## 三、微信小程序上传发布

前端构建产物在 `frontend/dist`，通过微信开发者工具上传发布。

### 1. 构建小程序产物

```bash
cd frontend
npm install
# 编译微信小程序
npm run build:weapp
# 产物输出到 frontend/dist
```

若需同时产出 H5：

```bash
npm run build:h5   # 产物在 frontend/dist
```

### 2. 配置 AppID

编辑 `frontend/project.config.json`，将 `appid` 由占位值改为真实小程序 AppID：

```json
{
  "miniprogramRoot": "./dist",
  "appid": "wx你的真实appid",
  "compileType": "miniprogram"
}
```

### 3. 配置后端 API 基址

小程序的生产 API 地址在编译期注入。编辑 `frontend/.env.production`：

```
TARO_APP_API_BASE_URL=https://your-domain.com/api
```

> 注意：实际读取的变量名为 `TARO_APP_API_BASE_URL`（见 `frontend/src/services/request.ts`）。微信小程序必须使用已备案的 HTTPS 域名。

### 4. 微信开发者工具上传

1. 打开微信开发者工具，导入项目目录 `frontend`
2. 确认 `project.config.json` 的 `miniprogramRoot` 指向 `./dist`
3. 点击右上角 **上传**，填写版本号与备注
4. 登录微信公众平台 -> 版本管理 -> 提交审核
5. 审核通过后点击 **发布**

### 5. 配置服务器域名

微信公众平台 -> 开发 -> 开发管理 -> 开发设置 -> 服务器域名，添加：

| 类型 | 域名 |
| --- | --- |
| `request` | `https://your-domain.com` |
| `uploadFile` | `https://your-domain.com` |
| `downloadFile` | `https://your-domain.com` |
| `socket`（可选） | 如使用 WebSocket 再配置 |

> 上传接口走 `POST /api/upload`（multipart），需在 `uploadFile` 域名白名单内；图片展示走 `downloadFile` 域名。

### 6. 申请订阅消息模板

出入库通知依赖微信订阅消息：

1. 微信公众平台 -> 订阅消息 -> 公共模板库，搜索"出库/入库"类模板
2. 选用并申请，记录模板 ID
3. 填入后端 `.env` 的 `WX_SUBSCRIBE_TEMPLATE_ID`
4. 模板字段需与 `backend/src/services/notification.service.ts` 的 `data` 字段对齐：
   - `thing1` 出/入库类型
   - `thing2` 器材名称
   - `number3` 数量
   - `thing4` 操作人
   - `time5` 操作时间

5. 用户首次操作时前端通过 `wx.requestSubscribeMessage` 引导授权

### 7. 体验版与真机调试

- 上传后在版本管理设置为体验版，扫码体验
- 真机调试时关闭开发者工具的"不校验合法域名"以验证域名白名单生效

---

## 四、首次初始化说明

- 首次启动且 `users` 表为空时，第一个登录的用户自动获得 **Admin** 角色，后续用户默认 **Viewer**。
- Admin 可在用户管理页将 Viewer 提升为 Editor。
- 种子数据（5 大类 + 20+ 器材）由 `backend/src/db/seed.ts` 提供，迁移后按需运行 `npm run seed`（本地开发）。

---

## 五、常见问题

| 现象 | 排查 |
| --- | --- |
| 容器启动后 healthcheck 失败 | `docker compose logs backend` 查看 better-sqlite3 是否编译成功；确认 DB_PATH 目录可写 |
| 微信登录 502 | 检查 `WX_APP_ID`/`WX_APP_SECRET` 是否正确；本地开发可用 `POST /api/auth/dev-login` |
| AI 识别返回 503 | `AI_API_KEY` 缺失或 AI 服务不可达，系统会自动降级到语义/文字搜索 |
| 通知未收到 | `WX_SUBSCRIBE_TEMPLATE_ID` 未配置时静默跳过；用户需在小程序内授权订阅 |
| 小程序请求失败 | 服务器域名未配置 HTTPS 白名单；`TARO_APP_API_BASE_URL` 指向错误 |
| 上传文件 404 | `UPLOAD_DIR` 与静态托管路径不一致；确认 `app.ts` 中 `/uploads` 静态目录与卷挂载对应 |
