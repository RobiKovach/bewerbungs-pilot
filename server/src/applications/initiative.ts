import type { PackageVacancy } from '@bp/shared';

/** "Initiativbewerbung – …" / "Initiativbewerbung als …" / "Unsolicited application as …": the prefix. */
const PREFIX = /^\s*(?:initiativ(?:e)?bewerbung|unsolicited application|initiative application)\b\s*(?:[–—:|-]\s*|(?:als|as|for)\s+)?/iu;

/**
 * The role an initiative card offers, without the "Initiativbewerbung" prefix its title starts with
 * (Task 10c titles: "Initiativbewerbung – Softwareentwickler"). '' when the title names no role.
 */
export function initiativeRole(title: string): string {
  const m = PREFIX.exec(title);
  return m ? title.slice(m[0].length).trim() : title.trim();
}

/** The card is an unsolicited application: the stored flag, or (older or edited cards) a title that starts with it. */
export function isInitiative(v: Pick<PackageVacancy, 'title'> & { initiative?: boolean }): boolean {
  return v.initiative === true || PREFIX.test(v.title);
}
