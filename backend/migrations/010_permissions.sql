CREATE TABLE IF NOT EXISTS permissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code VARCHAR(100) UNIQUE NOT NULL,
  name VARCHAR(50) NOT NULL,
  type VARCHAR(20) NOT NULL DEFAULT 'api',
  resource VARCHAR(255),
  description TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role VARCHAR(20) NOT NULL,
  permission_id INTEGER NOT NULL,
  PRIMARY KEY (role, permission_id),
  FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
);

INSERT OR IGNORE INTO permissions (code, name, type, resource, description) VALUES
('record:read', '查看记录', 'api', '/api/records', '查看出入库记录'),
('record:create', '创建记录', 'api', '/api/records', '创建出入库记录'),
('record:update', '编辑记录', 'api', '/api/records/:id', '编辑出入库记录'),
('record:delete', '删除记录', 'api', '/api/records/:id', '删除出入库记录'),
('record:photos', '管理照片', 'api', '/api/records/:id/photos', '管理记录照片'),
('equipment:read', '查看器材', 'api', '/api/equipments', '查看器材列表'),
('equipment:create', '创建器材', 'api', '/api/equipments', '创建器材'),
('equipment:update', '编辑器材', 'api', '/api/equipments/:id', '编辑器材'),
('equipment:delete', '删除器材', 'api', '/api/equipments/:id', '删除器材'),
('category:read', '查看分类', 'api', '/api/categories', '查看器材分类'),
('category:manage', '管理分类', 'api', '/api/categories', '增删改分类'),
('user:read', '查看用户', 'api', '/api/users', '查看用户列表'),
('user:manage', '管理用户', 'api', '/api/users', '管理用户角色和权限'),
('recycle:read', '查看回收站', 'api', '/api/recycle', '查看回收站'),
('recycle:manage', '管理回收站', 'api', '/api/recycle', '恢复/永久删除'),
('log:read', '查看日志', 'api', '/api/logs', '查看操作日志'),
('ai:use', '使用AI', 'api', '/api/ai', '使用AI助手'),
('upload:file', '上传文件', 'api', '/api/upload', '上传图片和文件');

INSERT OR IGNORE INTO role_permissions (role, permission_id) SELECT 'admin', id FROM permissions;

INSERT OR IGNORE INTO role_permissions (role, permission_id) SELECT 'editor', id FROM permissions WHERE code IN (
  'record:read', 'record:create', 'record:update', 'record:photos',
  'equipment:read', 'equipment:create', 'equipment:update',
  'category:read', 'ai:use', 'upload:file'
);

INSERT OR IGNORE INTO role_permissions (role, permission_id) SELECT 'viewer', id FROM permissions WHERE code IN (
  'record:read', 'equipment:read', 'category:read'
);
