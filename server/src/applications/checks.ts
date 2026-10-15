import type { PackageCv } from '@bp/shared';
import { PACKAGE_LIMITS as L } from './schema.js';
import type { CvOutput, LetterOutput, PackageContext } from './tasks/context.js';

/** fatal: breaks the structure — error at once. violations: rule 5/6 — one retry with this feedback (spec, section 3). */
export interface CheckResult { fatal: string | null; violations: string[] }

const MAX_SKILLS_PER_PARAGRAPH = 3;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordRe = (name: string) => new RegExp(`(^|[^\\p{L}\\p{N}])${esc(name)}(?=$|[^\\p{L}\\p{N}])`, 'iu');

/**
 * The "never mention" items that appear in the texts — as whole words, so "Kunde X" is not found in "Kunde Xylophon".
 * Spaces inside an item match any run of spaces or hyphens ("Kunde\nX", "Kunde-X-Seite" are still the same words).
 */
export function neverMentionedIn(texts: string[], items: string[]): string[] {
  const all = texts.join('\n');
  return items.filter((m) => {
    const words = m.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return false;
    return new RegExp(`(^|[^\\p{L}\\p{N}])${words.map(esc).join('[\\s\\-‐–]+')}(?=$|[^\\p{L}\\p{N}])`, 'iu').test(all);
  });
}

function neverMentioned(texts: string[], ctx: PackageContext): string[] {
  return neverMentionedIn(texts, ctx.neverMention).map((m) => `Do not mention "${m}" anywhere.`);
}

const bad = (fatal: string): CheckResult => ({ fatal, violations: [] });

export function checkLetter(out: LetterOutput, ctx: PackageContext): CheckResult {
  if (!out.subject.trim() || out.subject.length > L.subject) return bad('subject empty or too long');
  if (out.paragraphs.length < 3 || out.paragraphs.length > 4) return bad(`paragraphs: ${out.paragraphs.length} (3–4 expected)`);
  if (out.paragraphs.some((p) => !p.trim() || p.length > L.paragraph)) return bad('a paragraph is empty or too long');
  if (out.hint !== null && out.hint.length > L.hint) return bad('hint too long');
  const tellable = new Set(ctx.stories.map((s) => s.id));
  if (out.storyIds.length < 1 || out.storyIds.length > 2) return bad(`storyIds: ${out.storyIds.length} (1–2 expected)`);
  if (new Set(out.storyIds).size !== out.storyIds.length || out.storyIds.some((id) => !tellable.has(id))) return bad('storyIds: unknown or repeated id');

  const violations = neverMentioned([out.subject, ...out.paragraphs, out.hint ?? ''], ctx);
  const skills = ctx.skills.map((k) => k.name.trim()).filter((n) => n.length >= 2);
  out.paragraphs.forEach((p, i) => {
    const named = [...new Set(skills.filter((n) => wordRe(n).test(p)))];
    if (named.length > MAX_SKILLS_PER_PARAGRAPH) {
      violations.push(`Paragraph ${i + 1} lists ${named.length} skills (${named.join(', ')}). Tell a story instead of listing skills.`);
    }
  });
  return { fatal: null, violations };
}

export function checkCv(out: CvOutput, ctx: PackageContext): CheckResult {
  if (!out.profil.trim() || out.profil.length > L.profil) return bad('profil empty or too long');
  const skillIds = ctx.skills.map((k) => k.id);
  const placed = out.skillGroups.flatMap((g) => g.skillIds);
  // The "3–5 groups" preference is a prompt rule; the code allows 1–5 so a small profile never fails.
  if (out.skillGroups.length < 1 || out.skillGroups.length > L.groupsMax) return bad(`skillGroups: ${out.skillGroups.length} groups`);
  if (out.skillGroups.some((g) => !g.name.trim() || g.name.length > L.groupName)) return bad('skillGroups: empty or long name');
  if (placed.length !== skillIds.length || new Set(placed).size !== placed.length || placed.some((id) => !skillIds.includes(id))) return bad('skillGroups: not every skill exactly once');
  if (!out.headline.trim() || out.headline.length > L.headline) return bad('headline empty or too long');
  const from = out.translations.map((t) => t.from).sort();
  if (from.join('\n') !== [...ctx.toTranslate].sort().join('\n')) return bad(`translations: ${from.length} given, ${ctx.toTranslate.length} expected`);
  if (out.translations.some((t) => !t.to.trim() || t.to.length > L.translation)) return bad('a translation is empty or too long');
  const wanted = [...ctx.education, ...ctx.experience].filter((e) => e.description.trim()).map((e) => e.id).sort();
  const given = out.descriptions.map((d) => d.id).sort();
  if (wanted.join('\n') !== given.join('\n')) return bad(`descriptions: ${given.length} given, ${wanted.length} expected`);
  if (out.descriptions.some((d) => !d.text.trim() || d.text.length > L.description)) return bad('a description is empty or too long');
  // Group names are Claude's words and printed in the CV. Translations are not checked: they are the profile's own
  // countries/languages, which the CV prints anyway — refusing them would make the package impossible to create.
  return { fatal: null, violations: neverMentioned([out.profil, out.headline, ...out.descriptions.map((d) => d.text), ...out.skillGroups.map((g) => g.name)], ctx) };
}

export function mergeChecks(...results: CheckResult[]): CheckResult {
  return {
    fatal: results.find((r) => r.fatal)?.fatal ?? null,
    violations: [...new Set(results.flatMap((r) => r.violations))],
  };
}

export function toCv(out: CvOutput): Pick<PackageCv, 'profil' | 'headline' | 'descriptions' | 'skillGroups' | 'translations'> {
  return {
    profil: out.profil.trim(), headline: out.headline.trim(),
    descriptions: Object.fromEntries(out.descriptions.map((d) => [d.id, d.text.trim()])),
    skillGroups: out.skillGroups.map((g) => ({ name: g.name.trim(), skillIds: [...g.skillIds] })),
    translations: Object.fromEntries(out.translations.map((t) => [t.from, t.to.trim()])),
  };
}
