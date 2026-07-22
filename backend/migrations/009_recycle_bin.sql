-- 回收站表：存储被删除的记录/分类/器材等数据，支持恢复
-- AI 误删数据时可通过回收站恢复，避免数据永久丢失
CREATE TABLE IF NOT EXISTS recycle_bin (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,               -- 'record' | 'category' | 'equipment'
  entity_id INTEGER NOT NULL,              -- 原数据 ID
  entity_data TEXT NOT NULL,                -- 完整的数据 JSON（含关联数据如照片）
  entity_summary TEXT,                      -- 摘要信息（用于列表显示，如器材名称+规格）
  deleted_by INTEGER REFERENCES users(id),
  deleted_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  restored_at TEXT,                         -- 恢复时间，NULL 表示尚未恢复
  restored_by INTEGER REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_recycle_bin_entity ON recycle_bin(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_recycle_bin_deleted_at ON recycle_bin(deleted_at);
CREATE INDEX IF NOT EXISTS idx_recycle_bin_restored ON recycle_bin(restored_at);
