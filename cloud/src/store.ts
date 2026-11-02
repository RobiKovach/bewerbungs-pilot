import type { Kind } from './validate.js';

export interface FeedbackRow {
  id: number;
  createdAt: string;
  version: string;
  language: string;
  kind: Kind;
  email: string;
  text: string;
  mailed: boolean;
}
export type NewFeedback = Omit<FeedbackRow, 'id' | 'mailed'>;

export interface Stats {
  users: { d1: number; d7: number; d30: number };
  /** Users of the last 30 days by their last version, most users first. */
  versions: Array<{ version: string; users: number }>;
}

export interface MailMessage { subject: string; text: string; replyTo: string }
/** Sends one mail to Robert; false (never a throw) when it did not go out. */
export interface Mailer { send(m: MailMessage): Promise<boolean> }

export interface Store {
  recordPing(id: string, version: string, day: string): Promise<void>;
  addFeedback(f: NewFeedback): Promise<number>;
  markMailed(id: number, ok: boolean): Promise<void>;
  /** Records one hit for `key` at `now` and returns the hits inside the last `windowMs`, this one included. */
  hit(key: string, windowMs: number, now: number): Promise<number>;
  stats(now: number): Promise<Stats>;
  listFeedback(limit: number): Promise<FeedbackRow[]>;
  purge(now: number): Promise<void>;
}

const DAY = 24 * 3600_000;
export const FEEDBACK_KEEP_MS = 365 * DAY;
export const PING_KEEP_MS = 400 * DAY;
/** IP-based hits ("ip:" keys) live at most 2 hours; the per-install day counters need a day, so they get two. */
export const IP_HIT_KEEP_MS = 2 * 3600_000;
export const OTHER_HIT_KEEP_MS = 2 * DAY;

export const utcDay = (t: number): string => new Date(t).toISOString().slice(0, 10);

/** The first day of the last n days (today counts as one). */
const since = (now: number, days: number) => utcDay(now - (days - 1) * DAY);

const byUsersThenVersion = (a: { version: string; users: number }, b: { version: string; users: number }) =>
  b.users - a.users || b.version.localeCompare(a.version, 'en', { numeric: true });

/** For tests and local runs. */
export class MemoryStore implements Store {
  private readonly pings = new Map<string, { version: string; day: string }>();
  private feedback: FeedbackRow[] = [];
  private hits: Array<{ key: string; at: number }> = [];
  private nextId = 1;

  async recordPing(id: string, version: string, day: string): Promise<void> {
    this.pings.set(id, { version, day });
  }

  async addFeedback(f: NewFeedback): Promise<number> {
    const id = this.nextId++;
    this.feedback.push({ ...f, id, mailed: false });
    return id;
  }

  async markMailed(id: number, ok: boolean): Promise<void> {
    const row = this.feedback.find((f) => f.id === id);
    if (row) row.mailed = ok;
  }

  async hit(key: string, windowMs: number, now: number): Promise<number> {
    this.hits.push({ key, at: now });
    return this.hits.filter((h) => h.key === key && h.at > now - windowMs).length;
  }

  async stats(now: number): Promise<Stats> {
    const rows = [...this.pings.values()];
    const count = (days: number) => rows.filter((r) => r.day >= since(now, days)).length;
    const versions = new Map<string, number>();
    for (const r of rows) if (r.day >= since(now, 30)) versions.set(r.version, (versions.get(r.version) ?? 0) + 1);
    return {
      users: { d1: count(1), d7: count(7), d30: count(30) },
      versions: [...versions].map(([version, users]) => ({ version, users })).sort(byUsersThenVersion),
    };
  }

  async listFeedback(limit: number): Promise<FeedbackRow[]> {
    return [...this.feedback].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id).slice(0, limit).map((f) => ({ ...f }));
  }

  async purge(now: number): Promise<void> {
    const oldest = new Date(now - FEEDBACK_KEEP_MS).toISOString();
    this.feedback = this.feedback.filter((f) => f.createdAt >= oldest);
    this.hits = this.hits.filter((h) => h.at >= now - (h.key.startsWith('ip:') ? IP_HIT_KEEP_MS : OTHER_HIT_KEEP_MS));
    const firstDay = utcDay(now - PING_KEEP_MS);
    for (const [id, p] of this.pings) if (p.day < firstDay) this.pings.delete(id);
  }
}

interface FeedbackDbRow { id: number; created_at: string; version: string; language: string; kind: Kind; email: string; text: string; mailed: number }

export class D1Store implements Store {
  constructor(private readonly db: D1Database) {}

  async recordPing(id: string, version: string, day: string): Promise<void> {
    await this.db.prepare(
      'INSERT INTO pings (install_id, version, last_day) VALUES (?1, ?2, ?3) '
      + 'ON CONFLICT (install_id) DO UPDATE SET version = excluded.version, last_day = excluded.last_day',
    ).bind(id, version, day).run();
  }

  async addFeedback(f: NewFeedback): Promise<number> {
    const r = await this.db.prepare(
      'INSERT INTO feedback (created_at, version, language, kind, email, text, mailed) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0)',
    ).bind(f.createdAt, f.version, f.language, f.kind, f.email, f.text).run();
    return Number(r.meta.last_row_id);
  }

  async markMailed(id: number, ok: boolean): Promise<void> {
    await this.db.prepare('UPDATE feedback SET mailed = ?1 WHERE id = ?2').bind(ok ? 1 : 0, id).run();
  }

  async hit(key: string, windowMs: number, now: number): Promise<number> {
    await this.db.prepare('INSERT INTO hits (key, at) VALUES (?1, ?2)').bind(key, now).run();
    const n = await this.db.prepare('SELECT COUNT(*) AS n FROM hits WHERE key = ?1 AND at > ?2').bind(key, now - windowMs).first<number>('n');
    return Number(n ?? 0);
  }

  async stats(now: number): Promise<Stats> {
    const d1 = since(now, 1);
    const d7 = since(now, 7);
    const d30 = since(now, 30);
    const users = await this.db.prepare(
      'SELECT COALESCE(SUM(last_day >= ?1), 0) AS d1, COALESCE(SUM(last_day >= ?2), 0) AS d7, COALESCE(SUM(last_day >= ?3), 0) AS d30 FROM pings',
    ).bind(d1, d7, d30).first<{ d1: number; d7: number; d30: number }>();
    const versions = await this.db.prepare(
      'SELECT version, COUNT(*) AS users FROM pings WHERE last_day >= ?1 GROUP BY version',
    ).bind(d30).all<{ version: string; users: number }>();
    return {
      users: { d1: Number(users?.d1 ?? 0), d7: Number(users?.d7 ?? 0), d30: Number(users?.d30 ?? 0) },
      versions: versions.results.map((v) => ({ version: v.version, users: Number(v.users) })).sort(byUsersThenVersion),
    };
  }

  async listFeedback(limit: number): Promise<FeedbackRow[]> {
    const r = await this.db.prepare(
      'SELECT id, created_at, version, language, kind, email, text, mailed FROM feedback ORDER BY created_at DESC, id DESC LIMIT ?1',
    ).bind(limit).all<FeedbackDbRow>();
    return r.results.map((f) => ({
      id: Number(f.id), createdAt: f.created_at, version: f.version, language: f.language, kind: f.kind,
      email: f.email, text: f.text, mailed: Number(f.mailed) === 1,
    }));
  }

  async purge(now: number): Promise<void> {
    await this.db.batch([
      this.db.prepare('DELETE FROM feedback WHERE created_at < ?1').bind(new Date(now - FEEDBACK_KEEP_MS).toISOString()),
      this.db.prepare("DELETE FROM hits WHERE key LIKE 'ip:%' AND at < ?1").bind(now - IP_HIT_KEEP_MS),
      this.db.prepare("DELETE FROM hits WHERE key NOT LIKE 'ip:%' AND at < ?1").bind(now - OTHER_HIT_KEEP_MS),
      this.db.prepare('DELETE FROM pings WHERE last_day < ?1').bind(utcDay(now - PING_KEEP_MS)),
    ]);
  }
}
