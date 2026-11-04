import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { ErrorBanner } from '../components/ErrorBanner';
import { ClaudeWorking } from '../profile/ClaudeWorking';
import { NewQuestions, type ReplaceState } from './NewQuestions';
import type { InterviewPrep, InterviewPrepView, PrepQuestion, PrepSummary } from '../types';

const AREAS = ['experience', 'theory', 'practice', 'language'] as const;

function Block({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className="feedback-block" aria-labelledby={id}>
      <h3 id={id}>{title}</h3>
      {children}
    </section>
  );
}

/** The figure and its caption are one piece: there is no way to show one without the other (spec 8). */
function Chance({ summary }: { summary: PrepSummary }) {
  const { t } = useTranslation();
  return (
    <div className="chance">
      <span className="chance__label">{t('interview.summary.chanceLabel')}</span>
      <div className="chance__figures">
        <strong className="chance__value">{`≈ ${summary.percent}%`}</strong>
        {summary.previousPercent !== null ? <span className="muted">{t('interview.summary.previous', { percent: summary.previousPercent })}</span> : null}
      </div>
      <p className="muted">{t('interview.summary.caption')}</p>
    </div>
  );
}

function QuestionList({ questions, language, action, disabled, onOpen }: {
  questions: readonly PrepQuestion[];
  language: 'de' | 'en';
  action: string;
  disabled: boolean;
  onOpen: (id: string) => void;
}) {
  return (
    <ul className="summary-list">
      {questions.map((q) => (
        <li key={q.id}>
          <span className="summary-list__text" lang={language}>{q.text}</span>
          <button type="button" className="btn ghost" disabled={disabled} onClick={() => onOpen(q.id)}>{action}</button>
        </li>
      ))}
    </ul>
  );
}

/**
 * The end of a set, opened only once every question has feedback. Without a summary that fits the answers it asks for one
 * on opening; with one it never calls the AI, so the figure cannot change just by looking at it again.
 */
export function SummaryView({ applicationId, prep, readOnly, onView, onReplaced, onRefresh, onOpen, onRepeatWeak, onBack }: {
  applicationId: string;
  prep: InterviewPrep;
  readOnly: boolean;
  onView: (view: InterviewPrepView) => void;
  onReplaced: (view: InterviewPrepView) => void;
  onRefresh: () => void;
  onOpen: (questionId: string) => void;
  onRepeatWeak: () => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const needed = !prep.summary && !readOnly;
  const [working, setWorking] = useState(needed);
  const [error, setError] = useState<unknown>(null);
  const [replace, setReplace] = useState<ReplaceState>('idle');
  const replacing = replace !== 'idle';
  // One click elsewhere would leave this screen, and leaving cancels the work.
  const generating = replace === 'working';
  const controller = useRef<AbortController | null>(null);

  const run = useCallback(async () => {
    const c = new AbortController();
    controller.current = c;
    setWorking(true);
    setError(null);
    try {
      onView(await api.interviewSummary(applicationId, c.signal));
    } catch (err) {
      if (!c.signal.aborted) {
        setError(err);
        onRefresh();
      }
    } finally {
      if (controller.current === c) controller.current = null;
      setWorking(false);
    }
  }, [applicationId, onView, onRefresh]);

  // Deferred by a tick: a mount that is undone at once (StrictMode) must not leave a call behind that makes the next one "busy".
  useEffect(() => {
    if (!needed) return undefined;
    const timer = setTimeout(() => { void run(); }, 0);
    return () => { clearTimeout(timer); controller.current?.abort(); };
  }, [needed, run]);

  const summary = prep.summary;
  const weak = prep.questions.filter((q) => q.answer?.feedback?.weak);
  const good = prep.questions.filter((q) => q.answer?.feedback && !q.answer.feedback.weak);
  const risk = summary ? prep.questions.find((q) => q.id === summary.biggestRisk.questionId) : undefined;
  return (
    <div className="card summary-view">
      <h2>{t('interview.summary.title')}</h2>
      {error ? <ErrorBanner error={error} /> : null}
      {working ? <ClaudeWorking textKey="interview.summary.working" onCancel={() => controller.current?.abort()} /> : null}
      {!working && !summary ? <p className="muted">{t('interview.summary.notReady')}</p> : null}
      {summary ? (
        <>
          <Chance summary={summary} />
          <Block title={t('interview.summary.areasTitle')}>
            <dl className="summary-areas">
              {AREAS.map((area) => (
                <div key={area}>
                  <dt>{t(`interview.summary.area.${area}`)}</dt>
                  <dd className="prep-text">{summary.areas[area]}</dd>
                </div>
              ))}
            </dl>
          </Block>
          <Block title={t('interview.summary.riskTitle')}>
            {risk ? <p><button type="button" className="link-btn summary-risk" lang={prep.language} disabled={generating} onClick={() => onOpen(risk.id)}>{risk.text}</button></p> : null}
            <p className="prep-text">{summary.biggestRisk.why}</p>
          </Block>
        </>
      ) : null}
      {working ? null : (
        <>
          <Block title={t('interview.summary.weakTitle')}>
            {weak.length > 0
              ? <QuestionList questions={weak} language={prep.language} action={t(readOnly ? 'interview.view' : 'interview.summary.repeat')} disabled={generating} onOpen={onOpen} />
              : <p>{t('interview.summary.noWeak')}</p>}
            {weak.length > 0 && !readOnly && !replacing ? (
              <div className="btn-row"><button type="button" className="btn" onClick={onRepeatWeak}>{t('interview.summary.repeatWeak')}</button></div>
            ) : null}
          </Block>
          {good.length > 0 ? (
            <details className="feedback-block">
              <summary>{t('interview.summary.goodTitle', { n: good.length })}</summary>
              <QuestionList questions={good} language={prep.language} action={t('interview.view')} disabled={generating} onOpen={onOpen} />
            </details>
          ) : null}
          {!replacing ? (
            <div className="btn-row summary-actions">
              {needed ? <button type="button" className="btn" onClick={() => void run()}>{t('interview.tryAgain')}</button> : null}
              <button type="button" className="btn ghost" onClick={onBack}>{t(summary ? 'interview.summary.openAll' : 'interview.allQuestions')}</button>
            </div>
          ) : null}
          {readOnly ? null : (
            <NewQuestions applicationId={applicationId} proposal={prep.language} labelKey="interview.newQuestions.button" onReplaced={onReplaced} onRefresh={onRefresh} onStateChange={setReplace} />
          )}
        </>
      )}
    </div>
  );
}
