-- P1-7: 为 users 表添加 status 列（支持用户禁用）
-- verifyToken 查 status=disabled 时拒绝访问
-- SQLite 不支持 ADD COLUMN IF NOT EXISTS，用 PRAGMA 检查
-- 此迁移用于新部署的 DB；已有 DB 由 auth.ts 的 ensureUsersStatusColumn 兜底添加
ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active';