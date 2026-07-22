import Database from 'better-sqlite3';

export const CURRENT_SCHEMA_VERSION = 1;

const MIGRATIONS: Record<number, (db: Database.Database) => void> = {
  1: (_db) => {
    // Baseline schema is applied via SCHEMA_STATEMENTS in applySchema().
  },
};

export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY NOT NULL,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const row = db
    .prepare('SELECT MAX(version) AS version FROM schema_migrations')
    .get() as { version: number | null };
  let currentVersion = row?.version ?? 0;

  const applyMigration = db.transaction((version: number) => {
    const migrate = MIGRATIONS[version];
    if (!migrate) {
      throw new Error(`Missing migration for schema version ${version}.`);
    }
    migrate(db);
    db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(version);
  });

  while (currentVersion < CURRENT_SCHEMA_VERSION) {
    const nextVersion = currentVersion + 1;
    applyMigration(nextVersion);
    currentVersion = nextVersion;
  }
}
