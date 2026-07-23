import db from '../db'
import { Role } from '../types'

export interface Permission {
  id: number
  code: string
  name: string
  type: string
  resource: string | null
  description: string | null
  created_at: string
  updated_at: string
}

export interface RolePermission {
  role: string
  permission_id: number
}

export function getAllPermissions(): Permission[] {
  return db.prepare('SELECT * FROM permissions ORDER BY id').all() as Permission[]
}

export function getPermissionsByRole(role: Role): string[] {
  return db
    .prepare(
      `SELECT p.code FROM permissions p
       JOIN role_permissions rp ON p.id = rp.permission_id
       WHERE rp.role = ?`
    )
    .all(role)
    .map((row) => (row as { code: string }).code)
}

export function getRolesWithPermissions(): Array<{ role: string; permissions: string[] }> {
  const roles: Role[] = ['admin', 'editor', 'viewer']
  return roles.map((role) => ({
    role,
    permissions: getPermissionsByRole(role),
  }))
}

export function grantPermissionToRole(role: Role, permissionId: number): void {
  db.prepare('INSERT OR IGNORE INTO role_permissions (role, permission_id) VALUES (?, ?)').run(role, permissionId)
}

export function revokePermissionFromRole(role: Role, permissionId: number): void {
  db.prepare('DELETE FROM role_permissions WHERE role = ? AND permission_id = ?').run(role, permissionId)
}

export function setRolePermissions(role: Role, permissionIds: number[]): void {
  db.prepare('DELETE FROM role_permissions WHERE role = ?').run(role)
  for (const id of permissionIds) {
    db.prepare('INSERT INTO role_permissions (role, permission_id) VALUES (?, ?)').run(role, id)
  }
}

export function hasPermission(role: Role, permissionCode: string): boolean {
  const count = db
    .prepare(
      `SELECT COUNT(*) as c FROM permissions p
       JOIN role_permissions rp ON p.id = rp.permission_id
       WHERE rp.role = ? AND p.code = ?`
    )
    .get(role, permissionCode) as { c: number }
  return count.c > 0
}

export function getPermissionById(id: number): Permission | undefined {
  return db.prepare('SELECT * FROM permissions WHERE id = ?').get(id) as Permission | undefined
}

export function getPermissionByCode(code: string): Permission | undefined {
  return db.prepare('SELECT * FROM permissions WHERE code = ?').get(code) as Permission | undefined
}
