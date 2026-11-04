/** Interview preparation of one application; kept beside the package, which stays frozen once it has been sent. */
export type PrepKind = 'experience' | 'theory' | 'practice';
export interface LanguageFix { said: string; correct: string; why: string }
export interface PrepFeedback { weak: boolean; content: string; languageFixes: LanguageFix[]; better: string }
export interface PrepAnswer { text: string; dontKnow: boolean; updatedAt: string; feedback: PrepFeedback | null }
export interface PrepQuestion { id: string; kind: PrepKind; text: string; code: string | null; answer: PrepAnswer | null }
export interface PrepSummary {
  percent: number; previousPercent: number | null;
  areas: { experience: string; theory: string; practice: string; language: string };
  biggestRisk: { questionId: string; why: string };
  fingerprint: string; createdAt: string;
}
export interface InterviewPrep {
  schemaVersion: 1; applicationId: string; language: 'de' | 'en'; createdAt: string; updatedAt: string;
  questions: PrepQuestion[]; employerQuestions: string[]; summary: PrepSummary | null;
}
export interface InterviewPrepView { prep: InterviewPrep | null; canStart: boolean; readOnly: boolean; defaultLanguage: 'de' | 'en' }
