import request from './request'

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
  permissions: string[]
}

export async function getAllPermissions(): Promise<Permission[]> {
  const res = await request.get('/permissions')
  return res.data || []
}

export async function getRolesWithPermissions(): Promise<RolePermission[]> {
  const res = await request.get('/permissions/roles')
  return res.data || []
}

export async function getRolePermissions(role: string): Promise<RolePermission> {
  const res = await request.get(`/permissions/roles/${role}`)
  return res.data
}

export async function updateRolePermissions(role: string, permissionIds: number[]): Promise<RolePermission> {
  const res = await request.put(`/permissions/roles/${role}`, { permissionIds })
  return res.data
}
