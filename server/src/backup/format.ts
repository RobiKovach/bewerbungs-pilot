import type { BackupKind, BackupMeta } from '@bp/shared';

export type { BackupKind, BackupMeta };

/** Backup zip format (spec 0.9.0, section 3.1): `backup.json` at the root + the data folders under their own names. */
export const BACKUP_FORMAT = 1;
export const META_FILE = 'backup.json';
export const BACKUP_KINDS = ['manual', 'installer', 'before-restore'] as const satisfies readonly BackupKind[];

/** What a backup may hold besides `backup.json`: this file and everything under these folders. */
export const BACKUP_FILES: readonly string[] = ['settings.json'];
export const BACKUP_FOLDERS: readonly string[] = ['profile', 'vacancies', 'applications'];

/** Limits for restoring (also refused when making a backup, so every backup this app writes can be restored). */
export const MAX_UNPACKED_BYTES = 1024 ** 3;
export const MAX_ENTRIES = 20_000;
export const MAX_META_BYTES = 64 * 1024;

/** Damaged files the stores set aside (`profile.corrupt-1712345678.json`) — never copied into a backup. */
export const SET_ASIDE = /\.(corrupt|invalid)-\d+\.json$/;

const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;
const SEMVER = /^\d+\.\d+\.\d+$/;

/**
 * Why a zip entry name may not be written into the data folder, or null if it may. Stricter than yauzl's own check:
 * Windows also treats `:` (alternate streams), device names (`NUL`) and trailing dots/spaces specially.
 */
export function entryProblem(name: string): string | null {
  if (name === META_FILE) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\\:\x00-\x1f]/.test(name)) return 'bad characters';
  if (name.startsWith('/')) return 'absolute path';
  const isFolder = name.endsWith('/');
  const segments = (isFolder ? name.slice(0, -1) : name).split('/');
  for (const s of segments) {
    if (s === '' || s === '.' || s === '..') return 'empty or relative segment';
    if (/[. ]$/.test(s)) return 'segment ends with a dot or space';
    if (RESERVED.test(s)) return 'reserved device name';
  }
  if (segments.length === 1 && !isFolder) return BACKUP_FILES.includes(segments[0]!) ? null : 'not a data file';
  return BACKUP_FOLDERS.includes(segments[0]!) ? null : 'not a data folder';
}

/** A symlink entry (made on Unix): its mode sits in the high 16 bits of the external attributes. */
export function isSymlink(externalFileAttributes: number): boolean {
  return ((externalFileAttributes >>> 16) & 0o170000) === 0o120000;
}

export function parseMeta(raw: unknown): BackupMeta | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const kind = BACKUP_KINDS.find((k) => k === r.kind);
  if (r.format !== BACKUP_FORMAT || r.app !== 'bewerbungs-pilot' || !kind) return null;
  if (typeof r.appVersion !== 'string' || !SEMVER.test(r.appVersion)) return null;
  if (typeof r.createdAt !== 'string' || Number.isNaN(Date.parse(r.createdAt))) return null;
  return { format: BACKUP_FORMAT, app: 'bewerbungs-pilot', appVersion: r.appVersion, createdAt: r.createdAt, kind };
}

/** -1 / 0 / 1 for plain `x.y.z` versions. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return Math.sign(d);
  }
  return 0;
}

/** `BewerbungsPilot-backup-YYYY-MM-DD-HHMM.zip` in the person's local time. */
export function backupFileName(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `BewerbungsPilot-backup-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}.zip`;
}
