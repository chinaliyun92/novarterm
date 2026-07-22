import Database from 'better-sqlite3';

import type { TerminalTriggerRule } from '../../shared/types/trigger';
import { BaseRepository } from './base-repository';
import {
  toBooleanFromInt,
  toNullableNumber,
  toNullableString,
  toNumber,
  toStringValue,
} from './row-mappers';

export class TerminalTriggerRepository extends BaseRepository<
  TerminalTriggerRule,
  TerminalTriggerRule,
  Partial<TerminalTriggerRule>
> {
  constructor(db: Database.Database) {
    super(db, 'terminal_triggers', {
      primaryKey: 'id',
      defaultOrderBy: 'created_at ASC, id ASC',
    });
  }

  replaceAll(rules: TerminalTriggerRule[]): TerminalTriggerRule[] {
    const deleteStatement = this.db.prepare('DELETE FROM terminal_triggers');
    const insertStatement = this.db.prepare(`
      INSERT INTO terminal_triggers (
        id,
        pattern,
        send_text,
        enabled,
        auto_send,
        hidden,
        source,
        source_server_id,
        created_at,
        updated_at
      ) VALUES (
        @id,
        @pattern,
        @send_text,
        @enabled,
        @auto_send,
        @hidden,
        @source,
        @source_server_id,
        @created_at,
        @updated_at
      )
    `);

    const transact = this.db.transaction((nextRules: TerminalTriggerRule[]) => {
      deleteStatement.run();
      for (const rule of nextRules) {
        insertStatement.run(this.toRowData(rule as unknown as Record<string, unknown>));
      }
    });

    transact(rules);
    return this.findAll();
  }

  protected toEntity(row: Record<string, unknown>): TerminalTriggerRule {
    const source = toNullableString(row.source);
    return {
      id: toStringValue(row.id),
      pattern: toStringValue(row.pattern),
      sendText: toStringValue(row.send_text),
      enabled: toBooleanFromInt(row.enabled),
      autoSend: toBooleanFromInt(row.auto_send),
      hidden: toBooleanFromInt(row.hidden),
      source: source === 'server_hidden' || source === 'user' ? source : undefined,
      sourceServerId: toNullableNumber(row.source_server_id) ?? undefined,
      createdAt: toNumber(row.created_at),
      updatedAt: toNumber(row.updated_at),
    };
  }

  protected toRowData(input: Record<string, unknown>): Record<string, unknown> {
    const row: Record<string, unknown> = {};

    if (input.id !== undefined) {
      row.id = input.id;
    }
    if (input.pattern !== undefined) {
      row.pattern = input.pattern;
    }
    if (input.sendText !== undefined) {
      row.send_text = input.sendText;
    }
    if (input.enabled !== undefined) {
      row.enabled = input.enabled ? 1 : 0;
    }
    if (input.autoSend !== undefined) {
      row.auto_send = input.autoSend ? 1 : 0;
    }
    if (input.hidden !== undefined) {
      row.hidden = input.hidden ? 1 : 0;
    }
    if (input.source !== undefined) {
      row.source = input.source;
    }
    row.source_server_id = input.sourceServerId ?? null;
    if (input.createdAt !== undefined) {
      row.created_at = input.createdAt;
    }
    if (input.updatedAt !== undefined) {
      row.updated_at = input.updatedAt;
    }

    return row;
  }
}
