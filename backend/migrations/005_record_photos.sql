-- 记录照片表：产品图/位置图/标注图/视频，随记录级联删除
CREATE TABLE IF NOT EXISTS record_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id INTEGER NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('product', 'location', 'annotated', 'video')) DEFAULT 'product',
  annotation_json TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
);

CREATE INDEX IF NOT EXISTS idx_record_photos_record ON record_photos(record_id);
