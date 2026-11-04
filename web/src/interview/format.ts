import type { ApplicationStatus, PrepQuestion } from '../types';

export type QuestionState = 'open' | 'pending' | 'done' | 'weak';

/** The application id of "#/applications/<id>/interview", else null. */
export function interviewRouteId(hash: string): string | null {
  const m = /^#\/applications\/([A-Za-z0-9_-]{1,64})\/interview$/.exec(hash);
  return m ? m[1] : null;
}

/** A question counts as done only once there is feedback: `pending` = answered, feedback still missing. */
export function questionState(q: PrepQuestion): QuestionState {
  if (!q.answer) return 'open';
  if (!q.answer.feedback) return 'pending';
  return q.answer.feedback.weak ? 'weak' : 'done';
}

export const isFinished = (q: PrepQuestion) => q.answer?.feedback != null;

/** The first question without feedback, or null when all have it. */
export const nextQuestion = (questions: readonly PrepQuestion[]) => questions.find((q) => !isFinished(q)) ?? null;

/** A draft is unsaved when it differs from the answer the server keeps (the server trims). */
export const isDraftUnsaved = (q: PrepQuestion, draft: string | undefined) => draft !== undefined && draft.trim() !== (q.answer?.text ?? '');

const OPEN: ReadonlySet<ApplicationStatus> = new Set<ApplicationStatus>(['sent', 'submitted', 'interview']);
const CLOSED: ReadonlySet<ApplicationStatus> = new Set<ApplicationStatus>(['rejected', 'offer', 'withdrawn']);
/** Preparation can start or go on. */
export const isPrepOpen = (status: ApplicationStatus) => OPEN.has(status);
/** A saved preparation can only be viewed. */
export const isPrepClosed = (status: ApplicationStatus) => CLOSED.has(status);
