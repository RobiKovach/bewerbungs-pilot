import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { ErrorBanner } from '../components/ErrorBanner';
import { InfoTip } from '../components/InfoTip';
import { ClaudeWorking } from './ClaudeWorking';
import { LIMITS } from './constants';
import { useProfile } from './ProfileContext';
import { useReportUnsaved } from './unsaved';
import { useCancellable } from './useCancellable';

export function FollowUps() {
  const { t } = useTranslation();
  const { view, apply } = useProfile();
  const call = useCancellable();
  const questions = view.profile.pendingQuestions;
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const answered = questions.map((q) => ({ questionId: q.id, answer: answers[q.id] ?? '' })).filter((a) => a.answer.trim());
  const [skipError, setSkipError] = useState<unknown>(null);
  const [skipping, setSkipping] = useState(false);
  useReportUnsaved(answered.length > 0);

  const ask = async () => {
    const v = await call.run((signal) => api.askFollowUps(signal));
    if (v) { setAnswers({}); apply(v); }
  };
  const structure = async () => {
    const v = await call.run((signal) => api.structureStories(answered, signal));
    if (v) { setAnswers({}); apply(v); }
  };
  /** Questions are optional: forget them without making stories (no Claude call). */
  const skip = async () => {
    setSkipError(null);
    setSkipping(true);
    try {
      apply(await api.skipFollowUps());
      setAnswers({});
    } catch (err) {
      setSkipError(err);
    } finally {
      setSkipping(false);
    }
  };

  return (
    <div className="card">
      {call.state.kind === 'running' ? (
        <ClaudeWorking textKey={questions.length ? 'profile.stories.structuring' : 'profile.stories.asking'} onCancel={call.cancel} />
      ) : questions.length === 0 ? (
        <>
          <p>{t('profile.stories.askIntro')}</p>
          <div className="btn-row">
            <button type="button" className="btn" onClick={() => void ask()}>{t('profile.stories.ask')}</button>
            <InfoTip textKey="info.profileAsk" />
          </div>
        </>
      ) : (
        <>
          <p>{t('profile.stories.answerIntro')}</p>
          {questions.map((q) => (
            <div key={q.id} className="field question">
              <label htmlFor={`q-${q.id}`}>{q.question}</label>
              <p className="field-hint">{q.why}</p>
              <textarea id={`q-${q.id}`} rows={3} maxLength={LIMITS.text} value={answers[q.id] ?? ''} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} />
            </div>
          ))}
          <div className="btn-row">
            <button type="button" className="btn" disabled={answered.length === 0 || skipping} onClick={() => void structure()}>{t('profile.stories.structure')}</button>
            <button type="button" className="btn ghost" disabled={skipping} onClick={() => void skip()}>{t('profile.stories.skip')}</button>
          </div>
        </>
      )}
      {call.state.kind === 'failed' ? <ErrorBanner error={call.state.error} /> : null}
      {skipError ? <ErrorBanner error={skipError} /> : null}
    </div>
  );
}
