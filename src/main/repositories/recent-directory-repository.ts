import Database from 'better-sqlite3';

import type {
  CreateRecentDirectoryInput,
  RecentDirectory,
  UpdateRecentDirectoryInput,
} from '../../shared/types/db';
import { BaseRepository } from './base-repository';
import { toNumber, toStringValue } from './row-mappers';

export class RecentDirectoryRepository extends BaseRepository<
  RecentDirectory,
  CreateRecentDirectoryInput,
  UpdateRecentDirectoryInput
> {
  constructor(db: Database.Database) {
    super(db, 'recent_directories', {
      defaultOrderBy: 'last_accessed_at DESC, id DESC',
      timestamps: {
        createdAtColumn: 'created_at',
      },
    });
  }

  protected toEntity(row: Record<string, unknown>): RecentDirectory {
    return {
      id: toNumber(row.id),
      serverId: toNumber(row.server_id),
      path: toStringValue(row.path),
      lastAccessedAt: toStringValue(row.last_accessed_at),
      createdAt: toStringValue(row.created_at),
    };
  }

  protected toRowData(input: Record<string, unknown>): Record<string, unknown> {
    const row: Record<string, unknown> = {};

    if (input.serverId !== undefined) {
      row.server_id = input.serverId;
    }
    if (input.path !== undefined) {
      row.path = input.path;
    }
    if (input.lastAccessedAt !== undefined) {
      row.last_accessed_at = input.lastAccessedAt;
    }

    return row;
  }
}
