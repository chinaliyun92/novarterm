import Database from 'better-sqlite3';

import type {
  CreateServerGroupInput,
  ServerGroup,
  UpdateServerGroupInput,
} from '../../shared/types/db';
import { BaseRepository } from './base-repository';
import { toNumber, toStringValue } from './row-mappers';

export class ServerGroupRepository extends BaseRepository<
  ServerGroup,
  CreateServerGroupInput,
  UpdateServerGroupInput
> {
  constructor(db: Database.Database) {
    super(db, 'server_groups', {
      defaultOrderBy: 'sort_order ASC, id ASC',
      timestamps: {
        createdAtColumn: 'created_at',
        updatedAtColumn: 'updated_at',
      },
    });
  }

  protected toEntity(row: Record<string, unknown>): ServerGroup {
    return {
      id: toNumber(row.id),
      name: toStringValue(row.name),
      sortOrder: toNumber(row.sort_order),
      createdAt: toStringValue(row.created_at),
      updatedAt: toStringValue(row.updated_at),
    };
  }

  protected toRowData(input: Record<string, unknown>): Record<string, unknown> {
    const row: Record<string, unknown> = {};

    if (input.name !== undefined) {
      row.name = input.name;
    }

    if (input.sortOrder !== undefined) {
      row.sort_order = input.sortOrder;
    }

    return row;
  }
}
