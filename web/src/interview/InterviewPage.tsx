import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { ErrorBanner } from '../components/ErrorBanner';
import { ClaudeWorking } from '../profile/ClaudeWorking';
import { useReportUnsaved } from '../profile/unsaved';
import { AnswerView } from './AnswerView';
import { QuestionCards } from './QuestionCards';
import { isDraftUnsaved, isFinished, nextQuestion } from './format';
import type { ApplicationView, InterviewPrep, InterviewPrepView, PrepQuestion } from '../types';

type InterviewLanguage = InterviewPrepView['defaultLanguage'];
const LANGUAGES: readonly InterviewLanguage[] = ['de', 'en'];

/** "Next": the first question still without feedback, not this one again; the cards when there is none. */
const nextAfter = (questions: readonly PrepQuestion[], currentId: string): string | null =>
  nextQuestion(questions.filter((q) => q.id !== currentId))?.id ?? null;

/** No set yet: the language of the interview, then the AI helper writes the questions. */
function StartPrep({ id, view, onView }: { id: string; view: InterviewPrepView; onView: (v: InterviewPrepView) => void }) {
  const { t } = useTranslation();
  const [language, setLanguage] = useState<InterviewLanguage>(view.defaultLanguage);
  const [error, setError] = useState<unknown>(null);
  const [working, setWorking] = useState(false);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const start = async () => {
    const controller = new AbortController();
    abort.current = controller;
    setError(null);
    setWorking(true);
    try {
      onView(await api.startInterview(id, language, false, controller.signal));
    } catch (err) {
      if (!controller.signal.aborted) setError(err);
    } finally {
      if (abort.current === controller) { abort.current = null; setWorking(false); }
    }
  };

  return (
    <div className="card">
      <p>{t('interview.intro')}</p>
      <div role="radiogroup" aria-label={t('interview.languageLabel')} className="filter-chips">
        {LANGUAGES.map((l) => (
          <label key={l} className={language === l ? 'chip active' : 'chip'}>
            <input type="radio" name="interview-language" value={l} checked={language === l} disabled={working} onChange={() => setLanguage(l)} />
            {t(`interview.language.${l}`)}
          </label>
        ))}
      </div>
      {error ? <ErrorBanner error={error} /> : null}
      {working
        ? <ClaudeWorking textKey="interview.creating" onCancel={() => abort.current?.abort()} />
        : <div className="btn-row"><button type="button" className="btn" onClick={() => void start()}>{t('interview.create')}</button></div>}
    </div>
  );
}

function PrepOverview({ prep, readOnly, onOpen }: { prep: InterviewPrep; readOnly: boolean; onOpen: (id: string) => void }) {
  const { t } = useTranslation();
  const done = prep.questions.filter(isFinished).length;
  const next = nextQuestion(prep.questions);
  /** Task 7 opens the summary here. */
  const openWhenAllDone = () => { if (prep.questions[0]) onOpen(prep.questions[0].id); };
  return (
    <>
      <div className="question-progress">
        <div>
          <strong>{t('interview.progress', { done, total: prep.questions.length })}</strong>
          <p className="muted">{t('interview.languageLine', { language: t(`interview.language.${prep.language}`) })}</p>
        </div>
        {readOnly ? null : next
          ? <button type="button" className="btn" onClick={() => onOpen(next.id)}>{t('interview.continue')}</button>
          : <button type="button" className="btn" onClick={openWhenAllDone}>{t('interview.seeAnswers')}</button>}
      </div>
      {readOnly ? <p className="notice" role="status">{t('interview.readOnly')}</p> : null}
      <QuestionCards questions={prep.questions} readOnly={readOnly} onOpen={onOpen} />
      <section className="card" aria-labelledby="employer-questions">
        <h2 id="employer-questions">{t('interview.employerTitle')}</h2>
        <p className="muted">{t('interview.employerHint')}</p>
        <ul>{prep.employerQuestions.map((q) => <li key={q}>{q}</li>)}</ul>
      </section>
    </>
  );
}

/** The preparation of one application: "#/applications/<id>/interview". */
export function InterviewPage({ id }: { id: string }) {
  const { t } = useTranslation();
  const [view, setView] = useState<InterviewPrepView | null>(null);
  const [application, setApplication] = useState<ApplicationView['application'] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [prepView, appView] = await Promise.all([api.interview(id), api.getApplication(id)]);
      setView(prepView);
      setApplication(appView.application);
    } catch (err) {
      setError(err);
    }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  // Drafts live here so that going back to the cards keeps them, and the leave warning still knows about them.
  const [drafts, setDrafts] = useState<Readonly<Record<string, string>>>({});
  const setDraft = (questionId: string, text: string | null) => setDrafts((prev) => {
    const next = { ...prev };
    if (text === null) delete next[questionId]; else next[questionId] = text;
    return next;
  });
  useReportUnsaved(view?.prep?.questions.some((q) => isDraftUnsaved(q, drafts[q.id])) ?? false);

  /** Quietly: the page keeps working on what it has if this fails. */
  const refresh = () => { api.interview(id).then(setView).catch(() => {}); };

  if (error) return <ErrorBanner error={error} onRetry={() => void load()} />;
  if (!view || !application) return <p className="muted">{t('common.loading')}</p>;
  const question = view.prep?.questions.find((q) => q.id === selected) ?? null;
  return (
    <section>
      <p><a href={`#/applications/${id}`}>{t('interview.back')}</a></p>
      <h1>{t('interview.title')}</h1>
      <p className="muted">{application.vacancy.company} — {application.vacancy.title}</p>
      {question && view.prep ? (
        <AnswerView
          key={question.id}
          applicationId={id}
          question={question}
          language={view.prep.language}
          readOnly={view.readOnly}
          draft={drafts[question.id]}
          onDraft={(text) => setDraft(question.id, text)}
          onView={setView}
          onRefresh={refresh}
          onNext={() => setSelected(view.prep ? nextAfter(view.prep.questions, question.id) : null)}
          onBack={() => setSelected(null)}
        />
      ) : view.prep ? <PrepOverview prep={view.prep} readOnly={view.readOnly} onOpen={setSelected} />
          : view.canStart ? <StartPrep id={id} view={view} onView={setView} />
            : <p className="notice" role="status">{t('interview.notAvailable')}</p>}
    </section>
  );
}
