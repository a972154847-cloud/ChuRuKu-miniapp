-- 器材分类表：两级树形结构（5 大类 + 子类），含种子数据
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  level INTEGER NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
);

-- 一级分类（5 大类，level=1）
INSERT INTO categories (parent_id, code, name, level, sort_order) VALUES
  (NULL, 'BUILDING_FACILITY', '建筑消防设施类', 1, 1),
  (NULL, 'EXTINGUISHER', '灭火器类', 1, 2),
  (NULL, 'FIRE_EQUIPMENT', '消防装备类', 1, 3),
  (NULL, 'ESCAPE', '避险逃生类', 1, 4),
  (NULL, 'EMERGENCY_LIGHTING', '应急照明与疏散类', 1, 5);

-- 二级分类（level=2），parent_id 通过 code 子查询引用父级
INSERT INTO categories (parent_id, code, name, level, sort_order) VALUES
  -- 建筑消防设施类
  ((SELECT id FROM categories WHERE code='BUILDING_FACILITY'), 'FIRE_ALARM', '火灾报警系统', 2, 1),
  ((SELECT id FROM categories WHERE code='BUILDING_FACILITY'), 'HYDRANT_SYSTEM', '消火栓系统', 2, 2),
  ((SELECT id FROM categories WHERE code='BUILDING_FACILITY'), 'SMOKE_CONTROL', '防排烟系统', 2, 3),
  ((SELECT id FROM categories WHERE code='BUILDING_FACILITY'), 'FIRE_SEPARATION', '防火分隔设施', 2, 4),
  -- 灭火器类
  ((SELECT id FROM categories WHERE code='EXTINGUISHER'), 'PORTABLE_POWDER', '手提式干粉灭火器', 2, 1),
  ((SELECT id FROM categories WHERE code='EXTINGUISHER'), 'PORTABLE_CO2', '手提式二氧化碳灭火器', 2, 2),
  ((SELECT id FROM categories WHERE code='EXTINGUISHER'), 'PORTABLE_WATER', '手提式水基型灭火器', 2, 3),
  ((SELECT id FROM categories WHERE code='EXTINGUISHER'), 'PORTABLE_CLEAN_GAS', '手提式洁净气体灭火器', 2, 4),
  ((SELECT id FROM categories WHERE code='EXTINGUISHER'), 'CART_EXTINGUISHER', '推车式灭火器', 2, 5),
  -- 消防装备类
  ((SELECT id FROM categories WHERE code='FIRE_EQUIPMENT'), 'FIRE_SUIT', '消防服', 2, 1),
  ((SELECT id FROM categories WHERE code='FIRE_EQUIPMENT'), 'FIRE_HELMET', '消防头盔', 2, 2),
  ((SELECT id FROM categories WHERE code='FIRE_EQUIPMENT'), 'FIRE_GLOVES', '消防手套', 2, 3),
  ((SELECT id FROM categories WHERE code='FIRE_EQUIPMENT'), 'FIRE_BOOTS', '消防靴', 2, 4),
  ((SELECT id FROM categories WHERE code='FIRE_EQUIPMENT'), 'AIR_BREATHING_APPARATUS', '正压式空气呼吸器', 2, 5),
  -- 避险逃生类
  ((SELECT id FROM categories WHERE code='ESCAPE'), 'SELF_RESCUE_MASK', '消防过滤式自救呼吸器', 2, 1),
  ((SELECT id FROM categories WHERE code='ESCAPE'), 'DESCENDER', '逃生缓降器', 2, 2),
  ((SELECT id FROM categories WHERE code='ESCAPE'), 'ESCAPE_MASK', '逃生面罩', 2, 3),
  ((SELECT id FROM categories WHERE code='ESCAPE'), 'EMERGENCY_LAMP', '应急照明灯', 2, 4),
  -- 应急照明与疏散类
  ((SELECT id FROM categories WHERE code='EMERGENCY_LIGHTING'), 'EXIT_SIGN', '疏散指示标志灯', 2, 1),
  ((SELECT id FROM categories WHERE code='EMERGENCY_LIGHTING'), 'EMERGENCY_LUMINAIRE', '应急照明灯具', 2, 2);
