import Database from 'better-sqlite3';

import type { CreateServerInput, Server, UpdateServerInput } from '../../shared/types/db';
import { BaseRepository } from './base-repository';
import {
  toBooleanFromInt,
  toNullableString,
  toNumber,
  toStringValue,
} from './row-mappers';

export class ServerRepository extends BaseRepository<
  Server,
  CreateServerInput,
  UpdateServerInput
> {
  constructor(db: Database.Database) {
    super(db, 'servers', {
      defaultOrderBy: 'is_favorite DESC, updated_at DESC, id DESC',
      timestamps: {
        createdAtColumn: 'created_at',
        updatedAtColumn: 'updated_at',
      },
    });
  }

  protected toEntity(row: Record<string, unknown>): Server {
    return {
      id: toNumber(row.id),
      groupId: row.group_id === null || row.group_id === undefined ? null : toNumber(row.group_id),
      name: toStringValue(row.name),
      host: toStringValue(row.host),
      port: toNumber(row.port),
      username: toStringValue(row.username),
      authType: toStringValue(row.auth_type) as Server['authType'],
      password: toNullableString(row.password),
      privateKeyPath: toNullableString(row.private_key_path),
      passphrase: toNullableString(row.passphrase),
      defaultDirectory: toNullableString(row.default_directory),
      isFavorite: toBooleanFromInt(row.is_favorite),
      lastConnectedAt: toNullableString(row.last_connected_at),
      createdAt: toStringValue(row.created_at),
      updatedAt: toStringValue(row.updated_at),
    };
  }

  protected toRowData(input: Record<string, unknown>): Record<string, unknown> {
    const row: Record<string, unknown> = {};

    if (input.groupId !== undefined) {
      row.group_id = input.groupId;
    }
    if (input.name !== undefined) {
      row.name = input.name;
    }
    if (input.host !== undefined) {
      row.host = input.host;
    }
    if (input.port !== undefined) {
      row.port = input.port;
    }
    if (input.username !== undefined) {
      row.username = input.username;
    }
    if (input.authType !== undefined) {
      row.auth_type = input.authType;
    }
    if (input.password !== undefined) {
      row.password = input.password;
    }
    if (input.privateKeyPath !== undefined) {
      row.private_key_path = input.privateKeyPath;
    }
    if (input.passphrase !== undefined) {
      row.passphrase = input.passphrase;
    }
    if (input.defaultDirectory !== undefined) {
      row.default_directory = input.defaultDirectory;
    }
    if (input.isFavorite !== undefined) {
      row.is_favorite = input.isFavorite ? 1 : 0;
    }
    if (input.lastConnectedAt !== undefined) {
      row.last_connected_at = input.lastConnectedAt;
    }

    return row;
  }
}
