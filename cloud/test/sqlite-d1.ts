import fs from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

/**
 * The subset of Cloudflare D1 that D1Store uses, backed by Node's built-in SQLite, so the real SQL of
 * schema.sql and D1Store runs in plain vitest (no Cloudflare runtime needed).
 */
export function sqliteD1(): D1Database {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(fileURLToPath(new URL('../schema.sql', import.meta.url).href), 'utf8'));
  const statement = (sql: string, params: SQLInputValue[] = []) => ({
    bind: (...values: unknown[]) => statement(sql, values as SQLInputValue[]),
    async run() {
      const r = db.prepare(sql).run(...params);
      return { success: true, meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) }, results: [] };
    },
    async first(col?: string) {
      const row = db.prepare(sql).get(...params) as Record<string, unknown> | undefined;
      if (!row) return null;
      return col ? row[col] : row;
    },
    async all() {
      return { success: true, meta: {}, results: db.prepare(sql).all(...params) };
    },
  });
  return {
    prepare: (sql: string) => statement(sql),
    async batch(list: Array<{ run(): Promise<unknown> }>) {
      const out = [];
      for (const s of list) out.push(await s.run());
      return out;
    },
  } as unknown as D1Database;
}
