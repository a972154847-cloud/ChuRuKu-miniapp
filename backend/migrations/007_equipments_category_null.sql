PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS equipments_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category_id INTEGER REFERENCES categories(id),
  spec TEXT,
  image_url TEXT,
  scrap_years INTEGER,
  threshold INTEGER DEFAULT 5,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
);

INSERT INTO equipments_new SELECT * FROM equipments;

DROP TABLE equipments;

ALTER TABLE equipments_new RENAME TO equipments;

CREATE INDEX IF NOT EXISTS idx_equipments_category ON equipments(category_id);

PRAGMA foreign_keys = ON;