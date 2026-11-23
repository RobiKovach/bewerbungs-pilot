/**
 * `BewerbungsPilot-transfer-YYYY-MM-DD-HHMM.zip` (local time), `…-encrypted.zip` with a password — the same name the
 * server gives the file (server/src/backup/format.ts transferFileName), suggested in the "Save as" window before the
 * file exists.
 */
export function transferFileName(now: Date, encrypted: boolean): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`;
  return `BewerbungsPilot-transfer-${stamp}${encrypted ? '-encrypted' : ''}.zip`;
}
