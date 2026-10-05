import type { PackageCv } from '@bp/shared';
import { PACKAGE_LIMITS as L } from './schema.js';
import type { CvOutput, LetterOutput, PackageContext } from './tasks/context.js';

/** fatal: breaks the structure — error at once. violations: rule 5/6 — one retry with this feedback (spec, section 3). */
export interface CheckResult { fatal: string | null; violations: string[] }

const MAX_SKILLS_PER_PARAGRAPH = 3;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordRe = (name: string) => new RegExp(`(^|[^\\p{L}\\p{N}])${esc(name)}(?=$|[^\\p{L}\\p{N}])`, 'iu');

function neverMentioned(texts: string[], ctx: PackageContext): string[] {
  const all = texts.join('\n').toLowerCase();
  return ctx.neverMention.filter((m) => all.includes(m.toLowerCase())).map((m) => `Do not mention "${m}" anywhere.`);
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
  if (out.skillOrder.length !== skillIds.length || new Set(out.skillOrder).size !== skillIds.length || out.skillOrder.some((id) => !skillIds.includes(id))) {
    return bad('skillOrder is not the same set of skills');
  }
  const wanted = [...ctx.education, ...ctx.experience].filter((e) => e.description.trim()).map((e) => e.id).sort();
  const given = out.descriptions.map((d) => d.id).sort();
  if (wanted.join('\n') !== given.join('\n')) return bad(`descriptions: ${given.length} given, ${wanted.length} expected`);
  if (out.descriptions.some((d) => !d.text.trim() || d.text.length > L.description)) return bad('a description is empty or too long');
  return { fatal: null, violations: neverMentioned([out.profil, ...out.descriptions.map((d) => d.text)], ctx) };
}

export function mergeChecks(...results: CheckResult[]): CheckResult {
  return {
    fatal: results.find((r) => r.fatal)?.fatal ?? null,
    violations: [...new Set(results.flatMap((r) => r.violations))],
  };
}

export function toCv(out: CvOutput): Omit<PackageCv, 'profilEditedByHand'> {
  // Temporary mapping of the old output shape; Task 5 replaces it.
  return {
    profil: out.profil.trim(), headline: '', headlineEditedByHand: false,
    descriptions: Object.fromEntries(out.descriptions.map((d) => [d.id, d.text.trim()])),
    skillGroups: [{ name: '', skillIds: [...out.skillOrder] }], translations: {},
  };
}
