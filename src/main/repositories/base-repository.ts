import Database from 'better-sqlite3';

export type Identifier = number | string;

type RowData = Record<string, unknown>;

interface TimestampColumns {
  createdAtColumn?: string;
  updatedAtColumn?: string;
}

export interface BaseRepositoryOptions {
  primaryKey?: string;
  defaultOrderBy?: string;
  timestamps?: TimestampColumns;
}

export abstract class BaseRepository<
  TEntity,
  TCreate,
  TUpdate,
> {
  protected readonly db: Database.Database;
  protected readonly tableName: string;
  protected readonly primaryKey: string;
  protected readonly defaultOrderBy: string;
  protected readonly timestamps: TimestampColumns;

  protected constructor(
    db: Database.Database,
    tableName: string,
    options: BaseRepositoryOptions = {},
  ) {
    this.db = db;
    this.tableName = tableName;
    this.primaryKey = options.primaryKey ?? 'id';
    this.defaultOrderBy = options.defaultOrderBy ?? `${this.primaryKey} DESC`;
    this.timestamps = options.timestamps ?? {};
  }

  findById(id: Identifier): TEntity | null {
    const stmt = this.db.prepare(
      `SELECT * FROM ${this.tableName} WHERE ${this.primaryKey} = ? LIMIT 1`,
    );
    const row = stmt.get(id) as RowData | undefined;
    return row ? this.toEntity(row) : null;
  }

  findAll(): TEntity[] {
    const stmt = this.db.prepare(
      `SELECT * FROM ${this.tableName} ORDER BY ${this.defaultOrderBy}`,
    );
    const rows = stmt.all() as RowData[];
    return rows.map((row) => this.toEntity(row));
  }

  create(input: TCreate): TEntity {
    const rowData = this.withCreateTimestamps(
      this.normalizeRowData(this.toRowData(input as unknown as Record<string, unknown>)),
    );

    const columns = Object.keys(rowData);
    if (columns.length === 0) {
      throw new Error(`${this.tableName} create payload is empty.`);
    }

    const placeholders = columns.map((column) => `@${column}`).join(', ');
    const insertSql = `INSERT INTO ${this.tableName} (${columns.join(', ')}) VALUES (${placeholders})`;
    const result = this.db.prepare(insertSql).run(rowData);

    const primaryValue = this.resolvePrimaryValue(rowData, result.lastInsertRowid);
    const entity = this.findById(primaryValue);

    if (!entity) {
      throw new Error(`${this.tableName} create succeeded but entity was not found.`);
    }

    return entity;
  }

  update(id: Identifier, input: TUpdate): TEntity | null {
    const rowData = this.normalizeRowData(
      this.toRowData(input as unknown as Record<string, unknown>),
    );
    if (Object.keys(rowData).length === 0) {
      return this.findById(id);
    }

    const dataWithTimestamp = this.withUpdateTimestamps(rowData);
    const columns = Object.keys(dataWithTimestamp);
    const assignments = columns
      .map((column) => `${column} = @${column}`)
      .join(', ');

    const updateSql = `UPDATE ${this.tableName} SET ${assignments} WHERE ${this.primaryKey} = @pk`;
    const result = this.db.prepare(updateSql).run({ ...dataWithTimestamp, pk: id });

    if (result.changes === 0) {
      return null;
    }

    return this.findById(id);
  }

  delete(id: Identifier): boolean {
    const stmt = this.db.prepare(
      `DELETE FROM ${this.tableName} WHERE ${this.primaryKey} = ?`,
    );
    const result = stmt.run(id);
    return result.changes > 0;
  }

  protected abstract toEntity(row: RowData): TEntity;
  protected abstract toRowData(input: Record<string, unknown>): RowData;

  private resolvePrimaryValue(rowData: RowData, lastInsertRowid: number | bigint): Identifier {
    const explicitPrimary = rowData[this.primaryKey];
    if (explicitPrimary !== undefined) {
      return explicitPrimary as Identifier;
    }

    return typeof lastInsertRowid === 'bigint'
      ? Number(lastInsertRowid)
      : lastInsertRowid;
  }

  private normalizeRowData(rowData: RowData): RowData {
    const normalized: RowData = {};

    for (const [key, value] of Object.entries(rowData)) {
      if (value !== undefined) {
        normalized[key] = value;
      }
    }

    return normalized;
  }

  private withCreateTimestamps(rowData: RowData): RowData {
    const now = new Date().toISOString();
    const withTimestamps: RowData = { ...rowData };

    if (
      this.timestamps.createdAtColumn &&
      withTimestamps[this.timestamps.createdAtColumn] === undefined
    ) {
      withTimestamps[this.timestamps.createdAtColumn] = now;
    }

    if (
      this.timestamps.updatedAtColumn &&
      withTimestamps[this.timestamps.updatedAtColumn] === undefined
    ) {
      withTimestamps[this.timestamps.updatedAtColumn] = now;
    }

    return withTimestamps;
  }

  private withUpdateTimestamps(rowData: RowData): RowData {
    const withTimestamps: RowData = { ...rowData };

    if (
      this.timestamps.updatedAtColumn &&
      withTimestamps[this.timestamps.updatedAtColumn] === undefined
    ) {
      withTimestamps[this.timestamps.updatedAtColumn] = new Date().toISOString();
    }

    return withTimestamps;
  }
}
