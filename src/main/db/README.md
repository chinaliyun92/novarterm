# DB MVP Skeleton (T05-T07)

- `connection.ts`: better-sqlite3 连接入口（路径解析 + PRAGMA）。
- `schema.ts`: 6 张 MVP 表 + 索引 + 默认设置种子。
- `init.ts`: `initializeDatabase()` 一次性执行建表与默认设置初始化。
- `index.ts`: DB 模块统一导出。

说明：当前实现只覆盖 MVP 数据层骨架，不包含迁移版本管理与加密存储。
