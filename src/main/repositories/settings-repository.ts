import Database from 'better-sqlite3';

import type { CreateSettingInput, Setting, UpdateSettingInput } from '../../shared/types/db';
import { BaseRepository } from './base-repository';
import { toStringValue } from './row-mappers';

export class SettingsRepository extends BaseRepository<
  Setting,
  CreateSettingInput,
  UpdateSettingInput
> {
  constructor(db: Database.Database) {
    super(db, 'settings', {
      primaryKey: 'key',
      defaultOrderBy: 'key ASC',
      timestamps: {
        updatedAtColumn: 'updated_at',
      },
    });
  }

  protected toEntity(row: Record<string, unknown>): Setting {
    return {
      key: toStringValue(row.key),
      value: toStringValue(row.value),
      updatedAt: toStringValue(row.updated_at),
    };
  }

  protected toRowData(input: Record<string, unknown>): Record<string, unknown> {
    const row: Record<string, unknown> = {};

    if (input.key !== undefined) {
      row.key = input.key;
    }
    if (input.value !== undefined) {
      row.value = input.value;
    }

    return row;
  }
}
