# 器材装备出入库记录小程序

面向消防 / 应急场景的器材装备出入库记录小程序，解决纸质登记与微信群接龙带来的 **责任不清、记录易丢、数量难追溯、过期难提醒** 四大痛点。管理员高效记录、普通成员透明查看，每次出入库自动留痕与通知。

移动优先、权限分明、可追溯、可识别。

## 功能特性

- **F1 三级权限**：Admin（全权管理）/ Editor（记录编辑）/ Viewer（仅查看），首个登录用户自动成为 Admin
- **F2 出入库记录**：名称 + 数量 + 类型（出/入库）三项必填，自动记录时间与操作人
- **F3 照片上传**：单条记录 1-3 张照片 + 摆放位置示意图 Canvas 标注（箭头/圆点）
- **F4 联网搜索**：器材名称搜索候选清单，失败自动降级手动输入
- **F5 AI 识别**：多模态 AI 生成结构化描述 → 语义搜索 → 文字匹配三层降级链
- **F6 自动分类**：依据 GB 4351-2023、GB 50140-2025、消防产品目录 2024 内置消防器材 5 大类分类树，置信度低时降级手动
- **F7 通知与日志**：出入库触发微信订阅消息，操作日志仅追加不可篡改（who/what/when/before/after）
- **F8 仪表盘**：库存总量、近 7/30 天趋势、分类占比、低库存预警、过期器材清单（水基 6 年 / 干粉 10 年 / 二氧化碳 12 年）
- **F9 历史与详情**：列表筛选（时间/分类/操作人/关键字）+ 详情页照片画廊与日志时间线

## 技术栈

| 层 | 方案 |
| --- | --- |
| 前端 | Taro 4.2 + React 18 + TypeScript + NutUI-React-Taro + zustand |
| 后端 | Node.js + Express 5 + TypeScript（CommonJS） |
| 数据库 | SQLite（better-sqlite3），生产可切 MySQL |
| 多模态 AI | OpenAI 兼容接口（Qwen3-VL / GPT-4o 可切换） |
| 语义检索 | 本地 Embedding（`Xenova/bge-small-zh`）+ 余弦相似度 |
| 通知 | 微信订阅消息 |
| 文件存储 | 本地磁盘（生产可接 OSS） |

## 快速开始

### 环境要求

- Node.js >= 18（推荐 20）
- npm >= 9
- 微信开发者工具（小程序端调试，可选）

### 后端

```bash
cd backend
npm install
cp .env.example .env   # 按需填写 AI/微信凭据，本地开发可留空
npm run migrate         # 执行数据库迁移
npm run dev             # 启动开发服务 http://localhost:3000
```

> 开发服务启动时 `server.ts` 也会自动执行迁移，`npm run migrate` 可单独运行。
> 本地无微信凭据时可用 `POST /api/auth/dev-login` 测试登录（生产环境禁用）。

### 前端

```bash
cd frontend
npm install
npm run dev:h5          # H5 开发模式
# 或
npm run dev:weapp       # 微信小程序，用微信开发者工具打开 frontend 调试
```

前端默认连接 `http://localhost:3000/api`，可在 `frontend/.env.development` 修改 `TARO_APP_API_BASE_URL`。

### 默认账号

无预设账号。**首个登录用户自动获得 Admin 角色**，后续用户默认 Viewer。Admin 可在用户管理页将 Viewer 提升为 Editor。

## 环境变量

后端配置见 `backend/.env.example`，部署模板见根目录 `.env.example`：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | 3000 | 服务端口 |
| `NODE_ENV` | development | 环境（production 时禁用 dev-login） |
| `DB_PATH` | ./dev.db | SQLite 数据库路径 |
| `JWT_SECRET` | dev-secret-change-me | JWT 签名密钥，**生产必须修改** |
| `JWT_EXPIRES_IN` | 7d | Token 有效期 |
| `WX_APP_ID` | （空） | 微信小程序 AppID |
| `WX_APP_SECRET` | （空） | 微信小程序 Secret |
| `WX_SUBSCRIBE_TEMPLATE_ID` | （空） | 微信订阅消息模板 ID，缺失则通知静默跳过 |
| `AI_PROVIDER` | qwen | AI 提供商（qwen / openai） |
| `AI_BASE_URL` | https://dashscope.aliyuncs.com/compatible-mode/v1 | AI 接口基址 |
| `AI_API_KEY` | （空） | AI 服务密钥，缺失时降级 |
| `AI_MODEL` | qwen-vl-max | 多模态模型名 |
| `UPLOAD_DIR` | ./uploads | 上传文件目录 |
| `LOW_STOCK_THRESHOLD` | 5 | 低库存预警阈值 |

前端构建期变量：

| 变量 | 说明 |
| --- | --- |
| `TARO_APP_API_BASE_URL` | 后端 API 基址，编译期注入（见 `src/services/request.ts`） |

## 微信小程序配置

1. 在 [微信公众平台](https://mp.weixin.qq.com/) 注册小程序，获取 AppID 与 Secret
2. 编辑 `frontend/project.config.json`，将 `appid` 由 `touristappid` 改为真实 AppID
3. 配置服务器域名（开发设置 -> 服务器域名）：
   - `request`：后端 HTTPS 域名
   - `uploadFile`：后端 HTTPS 域名（上传 `POST /api/upload`）
   - `downloadFile`：后端 HTTPS 域名（图片展示）
4. 申请订阅消息模板，记录模板 ID 填入 `WX_SUBSCRIBE_TEMPLATE_ID`，字段对齐见 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)
5. 构建小程序：`cd frontend && npm run build:weapp`，用微信开发者工具打开 `frontend` 上传

> 小程序必须使用已备案的 HTTPS 域名。本地开发可在开发者工具勾选「不校验合法域名」。

## 项目结构

```
器材装备管理小程序/
├── backend/                 # 后端 Node.js + Express + TypeScript
│   ├── src/
│   │   ├── config/          # 配置读取
│   │   ├── db/              # 数据库连接、迁移、种子
│   │   ├── middlewares/     # 鉴权 authRequired 与角色守卫
│   │   ├── routes/          # 9 个 API 路由模块
│   │   ├── services/        # 业务逻辑（记录/AI/分类/通知/仪表盘等）
│   │   ├── types/           # 类型定义
│   │   ├── utils/           # 工具
│   │   ├── app.ts           # Express 应用与路由挂载
│   │   └── server.ts        # 启动入口（自动迁移 + 监听）
│   ├── migrations/          # SQL 迁移脚本 001-006
│   ├── tests/               # Jest 单元/集成测试
│   ├── Dockerfile
│   └── .env.example
├── frontend/                # 前端 Taro + React
│   ├── src/
│   │   ├── components/      # CategoryPicker / EquipmentPicker / PhotoAnnotator
│   │   ├── pages/           # 9 个页面（仪表盘/记录/详情/编辑/用户/分类/日志/我的/登录）
│   │   ├── services/        # API 调用封装
│   │   ├── store/           # zustand 状态
│   │   ├── types/           # 类型定义
│   │   └── app.config.ts    # 页面路由与 tabBar 配置
│   ├── e2e/                 # Playwright E2E 测试
│   └── project.config.json  # 微信小程序配置
├── docs/                    # API.md / DEPLOYMENT.md
├── docker-compose.yml       # 后端容器编排
├── .env.example             # 部署环境变量模板
└── .trae/specs/             # 需求规格文档
```

## 开发命令

### 后端（在 `backend/`）

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 开发模式热重载启动 |
| `npm run build` | TypeScript 编译到 `dist/` |
| `npm start` | 运行编译产物 `dist/server.js` |
| `npm test` | 运行 Jest 测试 |
| `npm run test:watch` | 测试监听模式 |
| `npm run lint` | ESLint 检查 |
| `npm run format` | Prettier 格式化 |
| `npm run migrate` | 执行数据库迁移 |

### 前端（在 `frontend/`）

| 命令 | 说明 |
| --- | --- |
| `npm run dev:h5` | H5 开发模式 |
| `npm run dev:weapp` | 微信小程序开发模式 |
| `npm run build:h5` | 构建 H5 产物 |
| `npm run build:weapp` | 构建微信小程序产物到 `dist/` |
| `npm test` | 运行 Vitest 组件测试 |

## 测试

```bash
# 后端单元/集成测试
cd backend && npm test

# 前端组件测试
cd frontend && npm test

# E2E 测试（基于 Playwright，针对 H5 模式）
cd frontend && npx playwright test
```

E2E 覆盖：Viewer 拒绝编辑、Editor 全流程出入库、Admin 用户管理。

## 部署

### Docker Compose（后端）

```bash
cp .env.example .env   # 填入生产凭据
docker compose up -d --build
curl http://localhost:3000/api/health   # 验证
```

数据库与上传文件通过 `backend-data` 数据卷持久化。详细步骤与备份恢复见 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)。

### 微信小程序发布

```bash
cd frontend
npm run build:weapp
# 用微信开发者工具打开 frontend -> 上传 -> 提交审核 -> 发布
```

完整发布流程（AppID 配置、服务器域名、订阅模板、体验版）见 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)。

## 相关文档

- [需求规格 spec.md](.trae/specs/add-equipment-in-out-miniapp/spec.md)
- [API 文档](docs/API.md)
- [部署指南](docs/DEPLOYMENT.md)

## 许可证

ISC
