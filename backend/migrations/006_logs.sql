-- 操作日志表：仅允许 INSERT，通过触发器禁止 UPDATE/DELETE（append-only）
CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id INTEGER,
  before_json TEXT,
  after_json TEXT,
  ip TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
);

CREATE INDEX IF NOT EXISTS idx_logs_actor ON logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_logs_entity ON logs(entity, entity_id);
CREATE INDEX IF NOT EXISTS idx_logs_action ON logs(action);
CREATE INDEX IF NOT EXISTS idx_logs_created_at ON logs(created_at);

-- 禁止 UPDATE
CREATE TRIGGER IF NOT EXISTS trg_logs_no_update BEFORE UPDATE ON logs
BEGIN
  SELECT RAISE(ABORT, 'logs table is append-only, UPDATE is forbidden');
END;

-- 禁止 DELETE
CREATE TRIGGER IF NOT EXISTS trg_logs_no_delete BEFORE DELETE ON logs
BEGIN
  SELECT RAISE(ABORT, 'logs table is append-only, DELETE is forbidden');
END;
