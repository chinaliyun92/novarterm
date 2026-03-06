import Database from 'better-sqlite3';

import type { DatabaseBootstrapOptions } from '../../shared/types/db';
import { createDatabaseConnection } from './connection';
import { DEFAULT_SETTINGS, SCHEMA_STATEMENTS } from './schema';

export function applySchema(db: Database.Database): void {
  const migrate = db.transaction(() => {
    for (const statement of SCHEMA_STATEMENTS) {
      db.exec(statement);
    }
  });

  migrate();
}

export function seedDefaultSettings(db: Database.Database): void {
  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT OR IGNORE INTO settings (key, value, updated_at)
     VALUES (@key, @value, @updatedAt)`,
  );

  const seed = db.transaction(() => {
    for (const setting of DEFAULT_SETTINGS) {
      insert.run({ key: setting.key, value: setting.value, updatedAt: now });
    }
  });

  seed();
}

export function initializeDatabase(
  options: DatabaseBootstrapOptions = {},
): Database.Database {
  const db = createDatabaseConnection(options);
  applySchema(db);
  seedDefaultSettings(db);
  return db;
}
