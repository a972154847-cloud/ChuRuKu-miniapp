# =============================================================================
# 后端镜像：Node.js 20 + Express 5 + TypeScript + better-sqlite3
# 多阶段构建：builder 编译 TypeScript 并 prune 依赖，runtime 仅保留运行时产物
# 运行入口：npm start -> node dist/server.js
#   server.js 启动时会自动执行数据库迁移（runMigrations），无需单独 migrate
# =============================================================================

# ---------- Stage 1: builder ----------
FROM node:20-alpine AS builder

WORKDIR /app

# better-sqlite3 为原生模块，alpine(musl) 需要编译工具链与 python3
RUN apk add --no-cache python3 make g++

# 先复制依赖清单，利用 Docker 层缓存
COPY package*.json ./

# 安装全部依赖（含 devDependencies，构建 TypeScript 需要 tsc）
RUN npm ci

# 复制源码并编译
COPY . .
RUN npm run build

# 移除开发依赖，仅保留运行时依赖（better-sqlite3 已编译产物保留）
RUN npm prune --production && npm cache clean --force

# ---------- Stage 2: runtime ----------
FROM node:20-alpine AS runtime

WORKDIR /app

# tini 作为 init 进程，正确转发信号（SIGTERM 等）给 node 进程
RUN apk add --no-cache tini

# 仅复制运行时必要文件：已 prune 的 node_modules + 编译产物 + package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package*.json ./

# 数据与上传目录（由 docker-compose 挂载卷持久化）
RUN mkdir -p /app/data /app/uploads

# 非 root 运行（node 镜像内置 node 用户 uid 1000）
RUN chown -R node:node /app
USER node

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# server.js 启动时自动执行 runMigrations()，无需在此单独运行 migrate
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["npm", "start"]