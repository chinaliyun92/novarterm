import Database from 'better-sqlite3';

import type {
  ConnectionRecord,
  CreateConnectionRecordInput,
  UpdateConnectionRecordInput,
} from '../../shared/types/db';
import { BaseRepository } from './base-repository';
import { toNullableNumber, toNullableString, toNumber, toStringValue } from './row-mappers';

export class ConnectionRecordRepository extends BaseRepository<
  ConnectionRecord,
  CreateConnectionRecordInput,
  UpdateConnectionRecordInput
> {
  constructor(db: Database.Database) {
    super(db, 'connection_records', {
      defaultOrderBy: 'started_at DESC, id DESC',
      timestamps: {
        createdAtColumn: 'created_at',
      },
    });
  }

  protected toEntity(row: Record<string, unknown>): ConnectionRecord {
    return {
      id: toNumber(row.id),
      serverId: toNumber(row.server_id),
      status: toStringValue(row.status) as ConnectionRecord['status'],
      startedAt: toStringValue(row.started_at),
      endedAt: toNullableString(row.ended_at),
      durationMs: toNullableNumber(row.duration_ms),
      exitCode: toNullableNumber(row.exit_code),
      errorMessage: toNullableString(row.error_message),
      createdAt: toStringValue(row.created_at),
    };
  }

  protected toRowData(input: Record<string, unknown>): Record<string, unknown> {
    const row: Record<string, unknown> = {};

    if (input.serverId !== undefined) {
      row.server_id = input.serverId;
    }
    if (input.status !== undefined) {
      row.status = input.status;
    }
    if (input.startedAt !== undefined) {
      row.started_at = input.startedAt;
    }
    if (input.endedAt !== undefined) {
      row.ended_at = input.endedAt;
    }
    if (input.durationMs !== undefined) {
      row.duration_ms = input.durationMs;
    }
    if (input.exitCode !== undefined) {
      row.exit_code = input.exitCode;
    }
    if (input.errorMessage !== undefined) {
      row.error_message = input.errorMessage;
    }

    return row;
  }
}
