import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { ErrorBanner } from '../components/ErrorBanner';
import { ClaudeWorking } from '../profile/ClaudeWorking';
import { TextField } from '../profile/fields';
import { FeedbackView, YourAnswer } from './FeedbackView';
import { isDraftUnsaved } from './format';
import type { InterviewPrepView, PrepQuestion } from '../types';

const ANSWER_MAX = 5000;

/**
 * One question: the person answers first, without hints, then sees the feedback. The draft lives in the page, so going back
 * to the cards does not lose it. Mount with `key={question.id}`.
 */
export function AnswerView({ applicationId, setCreatedAt, question, language, readOnly, draft, onDraft, onView, onRefresh, onNext, onBack, extraActions }: {
  applicationId: string;
  /** The set this view shows: the server refuses an answer meant for another set (ids repeat between sets). */
  setCreatedAt: string;
  question: PrepQuestion;
  language: 'de' | 'en';
  readOnly: boolean;
  draft: string | undefined;
  /** null = no draft any more. */
  onDraft: (text: string | null) => void;
  onView: (view: InterviewPrepView) => void;
  /** The server saves the answer before asking the AI, so after a failure the page has to learn that it is there. */
  onRefresh: () => void;
  onNext: () => void;
  onBack: () => void;
  /** A place for further ways to answer. Empty in this version. */
  extraActions?: ReactNode;
}) {
  const { t } = useTranslation();
  const answer = question.answer;
  const [editing, setEditing] = useState(!answer?.feedback || isDraftUnsaved(question, draft));
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<unknown>(null);
  // "I don't know" stores no text: what was typed before it is still offered by "Try again".
  const [typedBefore, setTypedBefore] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  const text = draft ?? answer?.text ?? '';

  const send = async (dontKnow: boolean) => {
    const c = new AbortController();
    controller.current = c;
    setWorking(true);
    setError(null);
    // The server replaces the saved text before it asks the AI: if the call does not finish, only this draft still has it.
    if (dontKnow && text) onDraft(text);
    try {
      const view = await api.answerInterview(applicationId, question.id, { text: dontKnow ? '' : text.trim(), dontKnow, setCreatedAt }, c.signal);
      if (dontKnow) setTypedBefore(text);
      onDraft(null);
      setEditing(false);
      onView(view);
    } catch (err) {
      if (!c.signal.aborted) setError(err);
      onRefresh();
    } finally {
      if (controller.current === c) controller.current = null;
      setWorking(false);
    }
  };

  const tryAgain = () => {
    onDraft(answer?.text || typedBefore);
    setError(null);
    setEditing(true);
  };

  const showForm = editing && !readOnly;
  const unsaved = isDraftUnsaved(question, draft);
  return (
    <div className="card answer-view">
      <span className="question-card__kind muted">{t(`interview.kind.${question.kind}`)}</span>
      <h2>{question.text}</h2>
      {question.code ? <pre className="question-code">{question.code}</pre> : null}
      {error ? <ErrorBanner error={error} /> : null}
      {working ? <ClaudeWorking textKey="interview.working" onCancel={() => controller.current?.abort()} /> : null}
      {showForm && !working ? (
        <>
          {answer && !answer.feedback && !answer.dontKnow && !unsaved ? <p className="notice" role="status">{t('interview.pendingNote')}</p> : null}
          <p className="muted">{t('interview.languageLine', { language: t(`interview.language.${language}`) })}</p>
          <TextField multiline rows={8} label={t('interview.yourAnswer')} value={text} onChange={onDraft} maxLength={ANSWER_MAX} hint={`${text.length} / ${ANSWER_MAX}`} />
          <div className="btn-row">
            <button type="button" className="btn" disabled={text.trim() === ''} onClick={() => void send(false)}>{t('interview.getFeedback')}</button>
            <button type="button" className="btn ghost" onClick={() => void send(true)}>{t('interview.dontKnow')}</button>
            {extraActions}
          </div>
        </>
      ) : null}
      {!showForm && answer?.feedback ? <FeedbackView answer={answer} feedback={answer.feedback} language={language} /> : null}
      {!showForm && answer && !answer.feedback ? <YourAnswer answer={answer} /> : null}
      {!showForm && !answer && !unsaved ? <p className="muted">{t('interview.noAnswer')}</p> : null}
      {/* The application was closed while the person was typing: the field is gone, the text must not be. */}
      {readOnly && unsaved ? (
        <section className="feedback-block">
          <p className="muted">{t('interview.unsavedDraft')}</p>
          <p className="prep-text">{draft}</p>
        </section>
      ) : null}
      {working ? null : (
        <div className="btn-row">
          {!showForm && !readOnly ? (
            <>
              <button type="button" className="btn" onClick={onNext}>{t('interview.next')}</button>
              <button type="button" className="btn ghost" onClick={tryAgain}>{t('interview.tryAgain')}</button>
            </>
          ) : null}
          <button type="button" className="btn ghost" onClick={onBack}>{t('interview.allQuestions')}</button>
        </div>
      )}
    </div>
  );
}
