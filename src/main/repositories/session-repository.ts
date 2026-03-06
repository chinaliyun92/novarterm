import Database from 'better-sqlite3';

import type { CreateSessionInput, Session, UpdateSessionInput } from '../../shared/types/db';
import { BaseRepository } from './base-repository';
import { toNullableString, toNumber, toStringValue } from './row-mappers';

export class SessionRepository extends BaseRepository<
  Session,
  CreateSessionInput,
  UpdateSessionInput
> {
  constructor(db: Database.Database) {
    super(db, 'sessions', {
      defaultOrderBy: 'last_active_at DESC, id DESC',
      timestamps: {
        createdAtColumn: 'created_at',
        updatedAtColumn: 'updated_at',
      },
    });
  }

  protected toEntity(row: Record<string, unknown>): Session {
    return {
      id: toNumber(row.id),
      title: toStringValue(row.title),
      sessionType: toStringValue(row.session_type) as Session['sessionType'],
      serverId: row.server_id === null || row.server_id === undefined ? null : toNumber(row.server_id),
      shell: toNullableString(row.shell),
      cwd: toNullableString(row.cwd),
      status: toStringValue(row.status) as Session['status'],
      layout: toNullableString(row.layout),
      tabOrder: toNumber(row.tab_order),
      lastActiveAt: toStringValue(row.last_active_at),
      createdAt: toStringValue(row.created_at),
      updatedAt: toStringValue(row.updated_at),
    };
  }

  protected toRowData(input: Record<string, unknown>): Record<string, unknown> {
    const row: Record<string, unknown> = {};

    if (input.title !== undefined) {
      row.title = input.title;
    }
    if (input.sessionType !== undefined) {
      row.session_type = input.sessionType;
    }
    if (input.serverId !== undefined) {
      row.server_id = input.serverId;
    }
    if (input.shell !== undefined) {
      row.shell = input.shell;
    }
    if (input.cwd !== undefined) {
      row.cwd = input.cwd;
    }
    if (input.status !== undefined) {
      row.status = input.status;
    }
    if (input.layout !== undefined) {
      row.layout = input.layout;
    }
    if (input.tabOrder !== undefined) {
      row.tab_order = input.tabOrder;
    }
    if (input.lastActiveAt !== undefined) {
      row.last_active_at = input.lastActiveAt;
    }

    return row;
  }
}
