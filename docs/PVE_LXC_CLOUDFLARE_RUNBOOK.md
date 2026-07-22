# PVE LXC + Cloudflare Tunnel 部署运行手册

本文用于把器材装备管理后端部署到 PVE 的 Debian 12 LXC，并通过 Cloudflare Tunnel 提供微信小程序可访问的 HTTPS API。可将本文完整交给其他 AI 执行，但 AI 必须遵守本文的审批与边界要求。

## 1. 目标与架构

目标：提供 `https://api.<your-domain>/api`，使微信小程序能够调用 API、上传文件和加载上传图片。

链路如下：

```text
微信小程序 -> Cloudflare HTTPS 边缘 -> Cloudflare Tunnel -> LXC 内 cloudflared
           -> https://localhost:3000 -> Node.js / Express -> SQLite 与上传文件
```

- PVE 仅承载一个 Debian 12、非特权 LXC。
- 后端以 `systemd` 常驻，不依赖 Docker、Nginx 或公网入站端口。
- Cloudflare 负责公网 DNS 与受信任 HTTPS 证书；Tunnel 到 Cloudflare 为出站加密连接。
- 后端本地 HTTPS 使用专用私有 CA，仅供 `cloudflared` 验证，不能把该证书当作公网证书使用。

## 2. 必须先确认的参数

在任何写操作前，AI 必须列出并获得确认：

| 参数 | 示例 | 说明 |
| --- | --- | --- |
| PVE 地址与节点 | `192.168.x.x`、`pve-node` | 不在文档或代码中写密码 |
| CT ID / 名称 | `118` / `equipment-mgr` | 不能猜测或覆盖已有 CT |
| 模板与存储 | Debian 12、`local` / 指定存储 | 以 PVE 实际配置为准 |
| CPU / 内存 / 磁盘 | 2 核 / 4 GB / 32 GB | 可按负载调整 |
| API 域名 | `api.example.com` | 必须由 Cloudflare 托管 |
| Cloudflare Tunnel | 新建或已有 Tunnel | 不在命令行、仓库或日志输出令牌 |
| 代码来源 | Git URL 或受控上传目录 | 不执行未知下载脚本 |

## 3. 执行边界

### 允许的动作

1. 读取 PVE、LXC、服务、日志和网络状态。
2. 在用户明确确认后，新建指定 CT、安装明确列出的 Debian 包、创建专用系统用户与目录。
3. 在用户明确确认后，创建或更新本项目的 systemd 服务、Cloudflare Tunnel 路由和证书文件。
4. 仅验证已声明域名的 DNS、HTTPS 和项目 API。

### 禁止的动作

1. 不删除或重装任何未被用户明确指定的 CT、VM、磁盘、数据卷、DNS 记录或 Tunnel。
2. 不运行 `curl | bash`、来源不明的安装脚本、`git reset --hard`、递归删除或强制推送。
3. 不把密码、Cloudflare 令牌、微信 Secret、JWT Secret、AI Key、私有 URL 写入命令历史、仓库、文档或聊天输出。
4. 不修改 PVE 防火墙、路由、默认网关、其他容器网络或其他项目服务，除非用户单独确认。
5. 不使用旧的 `deploy/deploy-pve.sh` 直接部署：它面向 Docker/Nginx/Certbot，和本手册的 Tunnel 架构不一致。

### 必须暂停并请求确认的场景

- 创建、删除、重建或扩容 CT。
- 安装新软件、修改 systemd 服务、重启服务、修改 DNS/Tunnel 公网路由。
- 迁移、覆盖、删除 SQLite 数据库或上传文件。
- 更换生产密钥、证书、域名或 Cloudflare 账户权限。

## 4. 阶段 A：PVE 与 LXC

1. 只读检查：确认节点、存储、网络桥、CT ID 是否被占用、目标模板是否存在。
2. 若模板不存在，下载 Debian 12 标准 LXC 模板并校验下载结果。
3. 创建非特权 Debian 12 CT：建议 2 vCPU、4 GB RAM、32 GB 磁盘、`nesting=1,keyctl=1`、DHCP 或用户指定静态 IP。
4. 启动 CT，确认 `pct status <CTID>` 为 `running`，并记录 CT 名称、IP、存储和配置。
5. 仅在用户确认的情况下删除旧 CT；删除前必须确认 CT ID 与备份状态。

验收：PVE 到 CT 可执行只读命令，CT 能解析 DNS 并访问 Debian 软件源。

回滚：停止并删除本次新建的、已确认 ID 的 CT；不得触碰其他 CT。

## 5. 阶段 B：容器基础环境

在 CT 内执行：

1. 更新 APT 索引并安装最小依赖：`ca-certificates`、`curl`、`git`、`build-essential`、`python3`、`openssl`。
2. 安装受支持的 Node.js 20 LTS。安装源必须可验证；禁止管道执行远程脚本。
3. 创建不可登录服务用户，例如 `equipment`，以及项目目录：`/opt/equipment-mgr`。
4. 创建运行数据目录，权限只授予服务用户，例如数据库目录和上传目录。
5. 配置 SSH 时保留现有管理通道；不得在未验证新访问方式前禁用认证或改动防火墙。

验收：`node --version` 为 20.x；服务用户可读项目、可写运行数据目录。

## 6. 阶段 C：部署后端

1. 将经过审查的项目代码放入 `/opt/equipment-mgr`。不要复制本地 `.env`、令牌或用户数据。
2. 在 `backend` 目录执行依赖安装与构建：

```bash
npm ci
npm run build
```

3. 在容器内创建仅运行时可读的环境文件，例如 `/opt/equipment-mgr/runtime.env`，权限应为 `600`，所有者为服务用户。至少包含：

```text
NODE_ENV=production
PORT=3000
DB_PATH=/opt/equipment-mgr/data/equipment.db
UPLOAD_DIR=/opt/equipment-mgr/data/uploads
JWT_SECRET=<由用户安全提供的强随机值>
```

4. 仅在功能启用时补充微信登录、订阅消息或 AI 所需配置；缺失的可选密钥要确认应用会安全降级。
5. 创建 `equipment-mgr.service`，以服务用户运行 `node /opt/equipment-mgr/backend/dist/server.js`，并设置 `Restart=on-failure`、`NoNewPrivileges=true`、`PrivateTmp=true`。
6. 启动服务并检查 `systemctl is-active equipment-mgr.service`。

说明：应用生产模式会优先启动 HTTPS。不能在公开网络暴露自签名本地证书。

## 7. 阶段 D：本地 TLS 与 Cloudflare Tunnel

### 7.1 本地回源证书

1. 在 CT 内创建专用私有 CA 与仅含 `localhost`、`127.0.0.1` SAN 的服务证书。
2. 将 CA 安装到 `/usr/local/share/ca-certificates/` 后运行 `update-ca-certificates`。
3. 将服务证书部署到应用期望的 `backend/certs/cert.pem` 与 `backend/certs/key.pem`；私钥权限为 `600`，仅服务用户可读。
4. 替换前备份旧证书与私钥到受限目录，记录回滚路径但不输出私钥内容。
5. 重启应用，使用系统 CA 验证证书链。

### 7.2 Cloudflare Tunnel

1. 在 Cloudflare 创建命名 Tunnel，并在 CT 内安装 `cloudflared`。
2. 通过 systemd 令牌模式运行 Tunnel。令牌放在权限 `600` 的环境文件，不出现在服务定义、仓库或日志。
3. 在 Cloudflare 创建公共主机名：

```text
api.<your-domain> -> https://localhost:3000
```

4. Cloudflare 自动创建 CNAME。不要手动创建与 Tunnel 冲突的 A/AAAA/CNAME。
5. 重启 `cloudflared`，使其重新加载系统 CA 信任库。

验收：

```text
systemctl is-active equipment-mgr.service        -> active
systemctl is-active equipment-mgr-tunnel.service -> active
HTTPS 请求 https://api.<your-domain>/            -> 应用响应，不能是 Cloudflare 502
```

根路径返回应用 `404` 仍可接受，前提是响应来自应用而非 Cloudflare。再请求一个受认证 API，应得到预期的 `401` 或业务响应。

排障：若 Tunnel 日志出现 `x509: certificate signed by unknown authority`，先确认 CA 已安装，再重启 `equipment-mgr-tunnel.service`。

## 8. 阶段 E：小程序构建与发布

1. 构建前，将前端 API 基址设置为：

```text
TARO_APP_API_BASE_URL=https://api.<your-domain>/api
```

2. 在 `frontend` 执行：

```bash
npm ci
npm run build:weapp
```

3. 微信公众平台“服务器域名”设置：

| 类型 | 值 |
| --- | --- |
| request | `https://api.<your-domain>` |
| uploadFile | `https://api.<your-domain>` |
| downloadFile | `https://api.<your-domain>` |

本项目没有 WebSocket 时无需配置 socket、UDP、TCP 域名。单个域名不要加尾随分号。

4. 在微信开发者工具导入 `frontend`，确认 `project.config.json` 的 AppID 与 `miniprogramRoot`，上传体验版。
5. 真机测试必须开启合法域名校验，完成登录、读取列表、上传图片、下载/展示图片和权限拒绝场景。
6. 只有体验版验收通过且域名备案/微信校验满足要求时，提交审核和发布。

## 9. 数据、备份与更新

- 备份对象：SQLite 数据库、上传文件、运行时环境文件的安全副本、systemd 单元、Tunnel 配置说明。
- 更新前先创建带时间戳的数据库与上传目录备份，并记录当前代码 commit 或发布包版本。
- 更新顺序：上传/拉取代码 -> `npm ci` -> `npm run build` -> 重启应用 -> 本地验证 -> 公网验证。
- 数据库迁移失败或应用无法启动时：停止更新、恢复上一个代码版本和数据备份、重启服务；不得清空数据库“重试”。

## 10. 最终验收清单

- [ ] 指定 CT 正在运行，资源和网络记录完整。
- [ ] 后端与 Tunnel 两个 systemd 服务均为 `active` 且已 `enable`。
- [ ] 公网 API 为可信 HTTPS，`curl` 不报证书错误，且不返回 Cloudflare 502。
- [ ] 未认证 API 返回预期 `401`，认证后核心业务可用。
- [ ] 上传与图片访问经过真实小程序设备验证。
- [ ] 数据与上传文件已有可恢复备份。
- [ ] 微信服务器域名与前端编译时 API 基址均指向 `https://api.<your-domain>`。
- [ ] 没有密钥、令牌、密码或私钥进入 Git、文档、服务日志或命令回显。

