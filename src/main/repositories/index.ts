import Database from 'better-sqlite3';

import { ConnectionRecordRepository } from './connection-record-repository';
import { RecentDirectoryRepository } from './recent-directory-repository';
import { ServerGroupRepository } from './server-group-repository';
import { ServerRepository } from './server-repository';
import { SessionRepository } from './session-repository';
import { SettingsRepository } from './settings-repository';

export interface RepositoryRegistry {
  serverGroups: ServerGroupRepository;
  servers: ServerRepository;
  connectionRecords: ConnectionRecordRepository;
  settings: SettingsRepository;
  recentDirectories: RecentDirectoryRepository;
  sessions: SessionRepository;
}

export function createRepositoryRegistry(db: Database.Database): RepositoryRegistry {
  return {
    serverGroups: new ServerGroupRepository(db),
    servers: new ServerRepository(db),
    connectionRecords: new ConnectionRecordRepository(db),
    settings: new SettingsRepository(db),
    recentDirectories: new RecentDirectoryRepository(db),
    sessions: new SessionRepository(db),
  };
}

export { BaseRepository } from './base-repository';
export { ConnectionRecordRepository } from './connection-record-repository';
export { RecentDirectoryRepository } from './recent-directory-repository';
export { ServerGroupRepository } from './server-group-repository';
export { ServerRepository } from './server-repository';
export { SessionRepository } from './session-repository';
export { SettingsRepository } from './settings-repository';
