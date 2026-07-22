import fs from 'node:fs';
import type Database from 'better-sqlite3';

function formatBackupTimestamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('');
}

export function backupCorruptDatabase(dbPath: string): string | null {
  if (!fs.existsSync(dbPath)) {
    return null;
  }

  const backupPath = `${dbPath}.corrupt-${formatBackupTimestamp(new Date())}`;
  fs.renameSync(dbPath, backupPath);

  for (const suffix of ['-wal', '-shm']) {
    const sidecarPath = `${dbPath}${suffix}`;
    if (fs.existsSync(sidecarPath)) {
      fs.renameSync(sidecarPath, `${backupPath}${suffix}`);
    }
  }

  return backupPath;
}

export function verifyDatabaseIntegrity(db: Database.Database): boolean {
  const rows = db.pragma('integrity_check') as Array<{ integrity_check: string }>;
  return rows.length > 0 && rows.every((row) => row.integrity_check === 'ok');
}
