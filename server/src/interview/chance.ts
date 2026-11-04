import crypto from 'node:crypto';
import type { InterviewPrep } from '@bp/shared';

const MIN = 5;
const MAX = 95;
const STEP = 5;

/**
 * The figure shown to the person (spec, section 8): never higher than the stored verdicts allow, within 5–95, rounded
 * down to a multiple of 5. A wrong or missing AI value must not flatter, so it gives the lowest figure.
 */
export function chancePercent(raw: number, weak: number, total: number): number {
  const strong = total > 0 ? (total - weak) / total : 0;
  const cap = 10 + 85 * strong;
  const value = Number.isFinite(raw) ? Math.min(raw, cap) : MIN;
  return Math.floor(Math.max(MIN, Math.min(MAX, value)) / STEP) * STEP;
}

/** Changes only with the answers themselves, so the figure is not recalculated without a reason. */
export function answersFingerprint(prep: InterviewPrep): string {
  const answers = prep.questions.map((q) => [q.id, q.answer ? q.answer.text : null, q.answer ? q.answer.dontKnow : null]);
  return crypto.createHash('sha256').update(JSON.stringify(answers), 'utf8').digest('hex');
}
