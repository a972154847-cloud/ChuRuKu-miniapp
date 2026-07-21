-- 器材库表：含报废年限与低库存阈值，预置 20 条基础数据
CREATE TABLE IF NOT EXISTS equipments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  spec TEXT,
  image_url TEXT,
  scrap_years INTEGER,
  threshold INTEGER DEFAULT 5,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
);

CREATE INDEX IF NOT EXISTS idx_equipments_category ON equipments(category_id);

-- 20 条种子数据：category_id 通过 code 子查询引用子类
INSERT INTO equipments (name, category_id, spec, scrap_years, threshold) VALUES
  ('手提式干粉灭火器 2kg ABC', (SELECT id FROM categories WHERE code='PORTABLE_POWDER'), '2kg', 10, 5),
  ('手提式干粉灭火器 4kg ABC', (SELECT id FROM categories WHERE code='PORTABLE_POWDER'), '4kg', 10, 5),
  ('手提式干粉灭火器 8kg ABC', (SELECT id FROM categories WHERE code='PORTABLE_POWDER'), '8kg', 10, 3),
  ('手提式二氧化碳灭火器 3kg', (SELECT id FROM categories WHERE code='PORTABLE_CO2'), '3kg', 12, 3),
  ('手提式二氧化碳灭火器 5kg', (SELECT id FROM categories WHERE code='PORTABLE_CO2'), '5kg', 12, 3),
  ('手提式水基型灭火器 3L', (SELECT id FROM categories WHERE code='PORTABLE_WATER'), '3L', 6, 5),
  ('手提式水基型灭火器 6L', (SELECT id FROM categories WHERE code='PORTABLE_WATER'), '6L', 6, 3),
  ('手提式洁净气体灭火器 4kg', (SELECT id FROM categories WHERE code='PORTABLE_CLEAN_GAS'), '4kg', 10, 2),
  ('推车式干粉灭火器 25kg', (SELECT id FROM categories WHERE code='CART_EXTINGUISHER'), '25kg', 10, 1),
  ('推车式二氧化碳灭火器 20kg', (SELECT id FROM categories WHERE code='CART_EXTINGUISHER'), '20kg', 12, 1),
  ('消防服（隔热服）', (SELECT id FROM categories WHERE code='FIRE_SUIT'), NULL, NULL, 3),
  ('消防头盔', (SELECT id FROM categories WHERE code='FIRE_HELMET'), NULL, NULL, 3),
  ('消防手套', (SELECT id FROM categories WHERE code='FIRE_GLOVES'), NULL, NULL, 10),
  ('消防靴', (SELECT id FROM categories WHERE code='FIRE_BOOTS'), NULL, NULL, 3),
  ('正压式空气呼吸器 6.8L', (SELECT id FROM categories WHERE code='AIR_BREATHING_APPARATUS'), '6.8L', NULL, 2),
  ('消防过滤式自救呼吸器', (SELECT id FROM categories WHERE code='SELF_RESCUE_MASK'), NULL, 3, 10),
  ('逃生缓降器', (SELECT id FROM categories WHERE code='DESCENDER'), NULL, 5, 2),
  ('疏散指示标志灯', (SELECT id FROM categories WHERE code='EXIT_SIGN'), NULL, NULL, 10),
  ('应急照明灯具', (SELECT id FROM categories WHERE code='EMERGENCY_LUMINAIRE'), NULL, NULL, 10),
  ('火灾报警按钮', (SELECT id FROM categories WHERE code='FIRE_ALARM'), NULL, NULL, 5);
