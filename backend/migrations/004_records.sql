-- 出入库记录表：type=in 入库 / type=out 出库
CREATE TABLE IF NOT EXISTS records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  equipment_id INTEGER REFERENCES equipments(id) ON DELETE RESTRICT,
  type TEXT NOT NULL CHECK(type IN ('in', 'out')),
  quantity INTEGER NOT NULL CHECK(quantity > 0),
  operator_id INTEGER NOT NULL REFERENCES users(id),
  produced_at TEXT,
  location_photo_url TEXT,
  ai_source TEXT,
  name_source TEXT,
  recipient TEXT,
  purpose TEXT,
  expected_return_at TEXT,
  remark TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
);

CREATE INDEX IF NOT EXISTS idx_records_equipment ON records(equipment_id);
CREATE INDEX IF NOT EXISTS idx_records_operator ON records(operator_id);
CREATE INDEX IF NOT EXISTS idx_records_type_created ON records(type, created_at);
CREATE INDEX IF NOT EXISTS idx_records_created_at ON records(created_at);
