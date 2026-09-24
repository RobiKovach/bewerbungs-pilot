export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationError';
  }
}

/** Turns a document of version n into version n + 1 (schemaVersion is set by migrate itself). */
export type Migration = (doc: Record<string, unknown>) => Record<string, unknown>;

/**
 * Brings a stored JSON document up to `current`. A document written by a NEWER app version (the person went back to
 * an older release) is refused instead of guessed at — the caller keeps the file aside.
 */
export function migrate(raw: unknown, current: number, migrations: Readonly<Record<number, Migration>>): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new MigrationError('not a JSON object');
  let doc = raw as Record<string, unknown>;
  const start = doc.schemaVersion;
  if (typeof start !== 'number' || !Number.isInteger(start) || start < 1) throw new MigrationError(`bad schemaVersion: ${String(start)}`);
  if (start > current) throw new MigrationError(`schemaVersion ${start} is newer than this app (${current})`);
  for (let v = start; v < current; v++) {
    const step = migrations[v];
    if (!step) throw new MigrationError(`no migration from version ${v}`);
    doc = { ...step(doc), schemaVersion: v + 1 };
  }
  return doc;
}
