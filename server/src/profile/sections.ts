import type { Section } from '@bp/shared';

const EMPTY_VALUES = new Set(['""', '[]', 'null']);
const join = (a: string, b: string) => (a ? `${a}.${b}` : b);

function isEntryList(v: unknown[]): v is { id: string }[] {
  return v.length > 0 && v.every((x) => typeof x === 'object' && x !== null && typeof (x as { id?: unknown }).id === 'string');
}

/**
 * Flattens section data to "path -> JSON value". List entries are addressed by id ("items.<id>.jobTitle"), so a path
 * survives reordering; lists of plain values ("jobTitles") and empty lists are one leaf each.
 */
export function leafPaths(data: unknown): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (v: unknown, p: string): void => {
    if (Array.isArray(v) && isEntryList(v)) {
      for (const entry of v) {
        for (const [k, x] of Object.entries(entry)) if (k !== 'id') walk(x, join(join(p, entry.id), k));
      }
      return;
    }
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      for (const [k, x] of Object.entries(v)) walk(x, join(p, k));
      return;
    }
    out.set(p, JSON.stringify(v));
  };
  walk(data, '');
  return out;
}

export function changedPaths(before: unknown, after: unknown): Set<string> {
  const a = leafPaths(before);
  const b = leafPaths(after);
  const changed = new Set<string>();
  for (const key of new Set([...a.keys(), ...b.keys()])) if (a.get(key) !== b.get(key)) changed.add(key);
  return changed;
}

export function filledPaths(data: unknown): string[] {
  return [...leafPaths(data)].filter(([, v]) => !EMPTY_VALUES.has(v)).map(([p]) => p);
}

/**
 * The content of section data as a string: JSON without entry ids (they are generated per extraction, so "same
 * content" ignores them). The web client builds the same string for the proposal it showed ("seen" on accept).
 */
export const withoutIds = (data: unknown) => JSON.stringify(data, (key, value: unknown) => (key === 'id' ? undefined : value));

/** The person saved the section: AI marks go away from every field they changed; the confirmation stays. */
export function applyHumanEdit<T>(section: Section<T>, data: T, at: string): Section<T> {
  const changed = changedPaths(section.data, data);
  const now = leafPaths(data);
  return {
    data,
    aiFields: section.aiFields.filter((p) => !changed.has(p) && now.has(p)),
    confirmedAt: section.confirmedAt,
    // Any change counts, also deleting an entry or clearing a field: nothing the person did is lost without their choice.
    editedAt: changed.size > 0 ? at : section.editedAt,
  };
}

/** "All correct": the person checked every field. */
export function confirmSection<T>(section: Section<T>, at: string): Section<T> {
  return { data: section.data, aiFields: [], confirmedAt: at, editedAt: section.editedAt };
}

/**
 * Untouched = since the section was last (re)filled from a CV, the person has neither confirmed it nor saved any change
 * to it. Only such a section may be replaced by a new CV without asking.
 */
export function isUntouched(section: Section<unknown>): boolean {
  return section.confirmedAt === null && section.editedAt === null;
}

/** The section as Claude read it: every filled field marked "AI – please check", not confirmed, no edits of the person. */
export function takeExtraction<T>(data: T): Section<T> {
  return { data, aiFields: filledPaths(data), confirmedAt: null, editedAt: null };
}

export type ExtractionOutcome = 'same' | 'replaced' | 'proposed';

/**
 * Claude read a (new) CV.
 * - Same content → the section stays exactly as it is (keeps "checked"); an older open proposal is dropped.
 * - Different content, untouched section → replaced (takeExtraction).
 * - Different content, the person worked on the section → the section stays exactly as it is and the new data becomes
 *   the section's proposal (replacing an older one); the person decides later ("Take the new version" / "Keep mine").
 * `proposal` is what the section's proposal must be afterwards (null = none).
 */
export function applyExtraction<T>(section: Section<T>, data: T): { section: Section<T>; outcome: ExtractionOutcome; proposal: T | null } {
  if (withoutIds(section.data) === withoutIds(data)) return { section, outcome: 'same', proposal: null };
  if (isUntouched(section)) return { section: takeExtraction(data), outcome: 'replaced', proposal: null };
  return { section, outcome: 'proposed', proposal: data };
}
