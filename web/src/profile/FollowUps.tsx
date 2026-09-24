import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { ErrorBanner } from '../components/ErrorBanner';
import { InfoTip } from '../components/InfoTip';
import { ClaudeWorking } from './ClaudeWorking';
import { useProfile } from './ProfileContext';
import { useCancellable } from './useCancellable';

export function FollowUps() {
  const { t } = useTranslation();
  const { view, apply } = useProfile();
  const call = useCancellable();
  const questions = view.profile.pendingQuestions;
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const answered = questions.map((q) => ({ questionId: q.id, answer: answers[q.id] ?? '' })).filter((a) => a.answer.trim());

  const ask = async () => {
    const v = await call.run((signal) => api.askFollowUps(signal));
    if (v) { setAnswers({}); apply(v); }
  };
  const structure = async () => {
    const v = await call.run((signal) => api.structureStories(answered, signal));
    if (v) { setAnswers({}); apply(v); }
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
              <textarea id={`q-${q.id}`} rows={3} value={answers[q.id] ?? ''} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} />
            </div>
          ))}
          <div className="btn-row">
            <button type="button" className="btn" disabled={answered.length === 0} onClick={() => void structure()}>{t('profile.stories.structure')}</button>
          </div>
        </>
      )}
      {call.state.kind === 'failed' ? <ErrorBanner error={call.state.error} /> : null}
    </div>
  );
}
