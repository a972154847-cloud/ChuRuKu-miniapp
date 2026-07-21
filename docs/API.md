# API 文档

器材装备出入库记录小程序后端 API。

## 通用约定

| 项 | 值 |
| --- | --- |
| Base URL | `http://localhost:3000/api`（生产替换为已备案 HTTPS 域名） |
| 认证方式 | `Authorization: Bearer <token>` |
| 请求体 | `application/json`（上传接口除外，使用 multipart/form-data） |
| 时间格式 | ISO 8601 字符串，服务器时间 UTC+8 |

### 响应格式

成功：

```json
{ "code": 0, "message": "ok", "data": { ... } }
```

失败：

```json
{ "code": <http_status>, "message": "<错误描述>" }
```

### 角色

- `admin` 管理员：全权管理
- `editor` 编辑者：新建/编辑记录、上传、AI 识别
- `viewer` 普通成员：仅查看

### 错误码

| HTTP | code | 含义 |
| --- | --- | --- |
| 400 | 400 | 参数错误 |
| 401 | 401 | 未登录 / token 失效 |
| 403 | 403 | 无权限 |
| 404 | 404 | 资源不存在 |
| 502 | 502 | 上游服务（微信）失败 |
| 503 | 503 | AI / 语义服务不可用（含降级提示） |

---

## 1. 健康检查

### `GET /api/health`

服务健康探测，无需鉴权。

**响应**

```json
{
  "code": 0,
  "message": "ok",
  "data": { "status": "up", "time": "2026-07-16T10:00:00.000Z" }
}
```

---

## 2. 认证模块 `/api/auth`

### `POST /api/auth/login`

微信小程序登录，换取 JWT。

- **鉴权**：无
- **Body**

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `code` | string | 是 | `wx.login()` 获取的临时 code |
| `nickname` | string | 否 | 昵称 |
| `avatar` | string | 否 | 头像 URL |

**响应**

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "token": "eyJhbGciOi...",
    "user": { "id": 1, "openid": "oXXX", "name": "张三", "role": "admin", "avatar": null }
  }
}
```

> 首次启动且无用户时，第一个登录用户自动成为 `admin`，后续默认 `viewer`。

### `POST /api/auth/dev-login`

开发环境登录，**生产环境（NODE_ENV=production）返回 403**。

- **鉴权**：无
- **Body**：`openid?`、`name?`、`role?`（admin/editor/viewer）

**响应**：同 `/login`，返回 `token` 与 `user`。

---

## 3. 用户模块 `/api/users`

> 全部需登录（`authRequired`）。

### `GET /api/users/me`

获取当前登录用户信息。

- **鉴权**：viewer+

**响应**：`data` 为当前 user 对象。

### `GET /api/users`

用户分页列表。

- **鉴权**：admin
- **Query**

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `role` | string | 角色筛选 admin/editor/viewer |
| `keyword` | string | 昵称关键字 |
| `page` | number | 默认 1 |
| `pageSize` | number | 默认 20 |

**响应**

```json
{
  "code": 0, "message": "ok",
  "data": { "list": [ /* user */ ], "total": 12, "page": 1, "pageSize": 20 }
}
```

### `GET /api/users/:id`

用户详情。非 admin 仅能查自己，否则 403。

- **鉴权**：viewer+

### `PATCH /api/users/:id/role`

修改用户角色。

- **鉴权**：admin
- **限制**：禁止修改自己的角色（403）
- **Body**：`{ "role": "admin" | "editor" | "viewer" }`

### `PATCH /api/users/:id/profile`

修改用户资料。

- **鉴权**：本人或 admin/editor
- **Body**：`{ "name"?: string, "avatar"?: string }`

---

## 4. 器材模块 `/api/equipments`

> 全部需登录。

### `GET /api/equipments`

器材分页列表（含分类名）。

- **鉴权**：viewer+
- **Query**：`page?`、`pageSize?`、`keyword?`

**响应**

```json
{
  "code": 0, "message": "ok",
  "data": {
    "list": [{ "id": 1, "name": "手提式干粉灭火器 2kg", "category_id": 5, "category_name": "手提式干粉", "spec": "...", "image_url": null, "scrap_years": 10, "threshold": 5 }],
    "total": 20, "page": 1, "pageSize": 20
  }
}
```

### `POST /api/equipments/search`

器材搜索（候选清单）。

- **鉴权**：editor+
- **Body**：`{ "keyword": "干粉" }`
- **响应**：`{ "data": { "list": [ /* equipment */ ] } }`

---

## 5. 分类模块 `/api/categories`

> 全部需登录。

### `GET /api/categories`

完整分类树（带 `children` 嵌套）。

- **鉴权**：viewer+

### `GET /api/categories/flat`

扁平分类列表。

- **鉴权**：viewer+

### `POST /api/categories/auto-suggest`

基于描述自动建议分类。

- **鉴权**：viewer+
- **Body**

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `description` | string | 是 | AI 描述或器材描述文本 |
| `equipment_name` | string | 否 | 器材名称辅助匹配 |

### `POST /api/categories`

创建分类节点。

- **鉴权**：admin
- **Body**：`name`(必填)、`code`(必填)、`parent_id?`、`level?`、`sort_order?`

### `PATCH /api/categories/:id`

修改分类。

- **鉴权**：admin
- **Body**：`name?`、`code?`、`parent_id?`、`level?`、`sort_order?`

### `DELETE /api/categories/:id`

删除分类。

- **鉴权**：admin
- **限制**：存在子分类或关联器材时返回 400

---

## 6. 记录模块 `/api/records`

> 全部需登录。记录字段含：`equipment_id`、`type`(in/out)、`quantity`、`produced_at`、`location_photo_url`、`ai_source`、`name_source`、`recipient`、`purpose`、`expected_return_at`、`remark`。

### `GET /api/records/stats`

出入库统计。

- **鉴权**：viewer+

### `POST /api/records`

创建出入库记录。

- **鉴权**：editor+
- **Body**

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `equipment_id` | number | 是 | 器材 ID |
| `type` | string | 是 | `in` 入库 / `out` 出库 |
| `quantity` | number | 是 | 正整数 |
| `produced_at` | string | 否 | 生产日期（过期判定用） |
| `recipient` | string | 否 | 领用人 |
| `purpose` | string | 否 | 用途 |
| `expected_return_at` | string | 否 | 预计归还日期 |
| `remark` | string | 否 | 备注 |
| `location_photo_url` | string | 否 | 摆放位置图 URL |
| `ai_source` | string | 否 | AI 来源标记 |
| `name_source` | string | 否 | 名称来源标记（manual/search） |

- **响应**：201 + 创建的 record（自动写入 `created_at`、`operator_id`）

### `GET /api/records`

记录列表（筛选 + 分页）。

- **鉴权**：viewer+
- **Query**：`type?`、`equipment_id?`、`operator_id?`、`category_id?`、`keyword?`、`start_date?`、`end_date?`、`page?`、`page_size?`（或旧字段 `pageSize?`）

**响应**（同时返回新旧字段以兼容）

```json
{
  "data": {
    "list": [ /* record */ ],
    "items": [ /* 同 list */ ],
    "total": 100, "page": 1,
    "pageSize": 20, "page_size": 20, "has_more": true
  }
}
```

### `GET /api/records/:id`

记录详情（含照片、操作人信息）。

- **鉴权**：viewer+

### `PUT /api/records/:id`

更新记录。**不允许修改 `equipment_id` 和 `type`**。

- **鉴权**：editor+
- **Body**：`quantity?`、`produced_at?`、`recipient?`、`purpose?`、`expected_return_at?`、`remark?`、`location_photo_url?`、`ai_source?`、`name_source?`

### `DELETE /api/records/:id`

删除记录（CASCADE 删除关联照片）。

- **鉴权**：admin

### `POST /api/records/:id/photos`

关联照片（单条记录最多 3 张照片 + 1 个视频）。

- **鉴权**：editor+
- **Body**

```json
{
  "photos": [
    { "url": "/uploads/xxx.jpg", "kind": "product", "annotation_json": "{}", "sort_order": 0 }
  ]
}
```

- `kind`：`product` 器材照片 / `location` 摆放位置示意图
- **响应**：201 + `{ "list": [ /* inserted */ ] }`

### `DELETE /api/records/:id/photos/:photoId`

删除单张照片。

- **鉴权**：editor+

---

## 7. 上传模块 `/api/upload`

> 全部需登录 + editor+。使用 `multipart/form-data`。

### `POST /api/upload`

单文件上传。字段名 `file`。单张 ≤5MB，视频 ≤10MB。

**响应**

```json
{
  "data": {
    "url": "/uploads/abc.jpg",
    "filename": "abc.jpg",
    "size": 102400,
    "mimeType": "image/jpeg"
  }
}
```

### `POST /api/upload/multiple`

多文件上传，字段名 `files`，最多 5 个。

**响应**：`{ "data": { "list": [ /* file info */ ] } }`

---

## 8. AI 模块 `/api/ai`

> 全部需登录 + editor+。AI 服务不可用时返回 503 并附 `fallback_hint` 提示降级路径。

### `POST /api/ai/describe-image`

多模态识别图片生成结构化描述。

- **Body**：`image_url` 或 `file_path`（二选一）
- **成功响应**

```json
{
  "data": {
    "description": { "type": "灭火器", "color": "红色", "material": "金属", "suspected_name": "手提式干粉灭火器", "confidence": 0.85 }
  }
}
```

- **失败响应**（503）

```json
{ "code": 503, "message": "AI 服务不可用", "fallback_hint": "semantic" }
```

### `POST /api/ai/match-equipment`

基于描述反向匹配器材库。

- **Body**：`description`（文本）或 `image_url`（自动描述后匹配）
- **响应**：`{ "data": { "matches": [ /* equipment */ ] } }`
- **失败**：503 + `fallback_hint: "semantic"`

### `POST /api/ai/semantic-search`

本地 Embedding 语义搜索（降级第 2 层）。

- **Body**：`{ "query": "红色灭火器" }`
- **响应**

```json
{
  "data": {
    "matches": [{ "equipment": { /* ... */ }, "score": 0.78 }],
    "fallback_hint": "text"   // 仅当 top score < 0.5 时附带
  }
}
```

- **失败**：503 + `fallback_hint: "text"`

### `POST /api/ai/text-search`

关键词文字模糊匹配（降级第 3 层，无外部依赖，始终 200）。

- **Body**：`{ "keyword": "干粉" }`
- **响应**：`{ "data": { "matches": [ /* equipment */ ] } }`

### `POST /api/ai/recognize`

统一识别入口，自动走三层降级链。

- **Body**：`image_url?`、`query?`
- **降级链**

| 阶段 | 条件 | 返回 `stage` |
| --- | --- | --- |
| 1. AI 图片识别 | 提供 `image_url` | `ai` |
| 2. 语义搜索 | AI 失败 + `query` 非空 + top score ≥ 0.5 | `semantic` |
| 3. 文字搜索 | 上述失败或 score < 0.5 | `text` |

- **响应**：`{ "data": { "stage": "ai" | "semantic" | "text", "matches": [ ... ] } }`

---

## 9. 仪表盘模块 `/api/dashboard`

> 全部需登录。

### `GET /api/dashboard`

综合仪表盘数据。

- **Query**：`days=7|30`（切换 trend 字段指向的时间范围，默认 7）
- **响应**

```json
{
  "data": {
    "totals": { /* 库存总量 */ },
    "byCategory": [ /* 按分类分组 */ ],
    "trend7d": [ /* 近 7 天趋势 */ ],
    "trend30d": [ /* 近 30 天趋势 */ ],
    "trend": [ /* 当前 days 对应的趋势 */ ],
    "categoryRatio": [ /* 分类占比 */ ],
    "lowStock": [ /* 低库存预警 */ ],
    "expiringSoon": [ /* 即将过期 */ ],
    "expired": [ /* 已过期 */ ]
  }
}
```

### `GET /api/dashboard/low-stock`

低库存预警列表（`quantity < threshold`）。

### `GET /api/dashboard/expiring`

过期 / 即将过期器材清单。

- **响应**：`{ "data": { "list": [...], "expired": [...], "expiringSoon": [...] } }`
- **报废年限**：水基 6 年、干粉 10 年、二氧化碳 12 年

---

## 10. 日志模块 `/api/logs`

> 全部需登录 + admin。日志表仅支持追加，不可 UPDATE/DELETE。

### `GET /api/logs/stats`

日志统计。

### `GET /api/logs`

分页查询操作日志。

- **Query**：`actor_id?`、`action?`、`entity?`、`start_date?`、`end_date?`、`page?`、`page_size?`

### `GET /api/logs/:id`

单条日志详情，含 `before_json` / `after_json` 审计快照。

---

## 附：标准请求示例

```bash
# 登录（开发环境）
curl -X POST http://localhost:3000/api/auth/dev-login \
  -H "Content-Type: application/json" \
  -d '{"name":"admin","role":"admin"}'

# 创建出库记录
curl -X POST http://localhost:3000/api/records \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"equipment_id":1,"type":"out","quantity":2,"recipient":"李四","purpose":"训练"}'

# 上传照片
curl -X POST http://localhost:3000/api/upload \
  -H "Authorization: Bearer <token>" \
  -F "file=@/path/to/photo.jpg"

# 仪表盘
curl http://localhost:3000/api/dashboard?days=30 \
  -H "Authorization: Bearer <token>"
```
