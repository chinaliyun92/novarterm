# Repository MVP Skeleton (T07)

- `base-repository.ts`: 通用 CRUD（`findById/findAll/create/update/delete`）。
- 各实体仓储：仅做字段映射（camelCase <-> snake_case）并复用基础 CRUD。
- `index.ts`: 仓储注册器 `createRepositoryRegistry(db)`。

说明：当前不扩展复杂查询与业务逻辑，仅提供 MVP 所需基础访问层。
