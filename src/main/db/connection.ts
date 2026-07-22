import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

import type { DatabaseBootstrapOptions } from '../../shared/types/db';
import { backupCorruptDatabase, verifyDatabaseIntegrity } from './recovery';

export const DEFAULT_DB_FILE_NAME = 'iterm-mvp.sqlite3';

export class DatabaseIntegrityError extends Error {
  constructor(message = 'Database integrity check failed') {
    super(message);
    this.name = 'DatabaseIntegrityError';
  }
}

export function resolveDatabasePath(options: DatabaseBootstrapOptions = {}): string {
  if (options.dbPath) {
    return path.resolve(options.dbPath);
  }

  const baseDir = options.dataDir
    ? path.resolve(options.dataDir)
    : path.resolve(process.cwd(), 'data');

  return path.join(baseDir, options.dbFileName ?? DEFAULT_DB_FILE_NAME);
}

function isRecoverableDatabaseCorruption(error: unknown): boolean {
  if (error instanceof DatabaseIntegrityError) {
    return true;
  }
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes('database integrity check failed') ||
    message.includes('file is not a database') ||
    message.includes('database disk image is malformed') ||
    message.includes('sqlite_corrupt')
  );
}

function openDatabaseFile(dbPath: string, options: DatabaseBootstrapOptions): Database.Database {
  const db = new Database(dbPath, {
    readonly: options.readonly ?? false,
    fileMustExist: options.fileMustExist ?? false,
  });

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');

  if (!verifyDatabaseIntegrity(db)) {
    db.close();
    throw new DatabaseIntegrityError();
  }

  return db;
}

export function createDatabaseConnection(
  options: DatabaseBootstrapOptions = {},
): Database.Database {
  const dbPath = resolveDatabasePath(options);

  if (!options.readonly) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  try {
    return openDatabaseFile(dbPath, options);
  } catch (error) {
    if (options.readonly || options.fileMustExist) {
      throw error;
    }

    // Never rename/wipe user data for non-corruption failures (e.g. native module
    // architecture mismatch). Those must surface so the good DB stays intact.
    if (!isRecoverableDatabaseCorruption(error)) {
      throw error;
    }

    backupCorruptDatabase(dbPath);
    return openDatabaseFile(dbPath, options);
  }
}
