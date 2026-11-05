import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { ErrorBanner } from '../components/ErrorBanner';
import { ClaudeWorking } from '../profile/ClaudeWorking';
import { useReportUnsaved } from '../profile/unsaved';
import { AnswerView } from './AnswerView';
import { LanguageChoice, NewQuestions, type ReplaceState } from './NewQuestions';
import { QuestionCards } from './QuestionCards';
import { SummaryView } from './SummaryView';
import { isDraftUnsaved, isFinished, nextQuestion } from './format';
import type { ApplicationView, InterviewPrep, InterviewPrepView, PrepQuestion } from '../types';

type InterviewLanguage = InterviewPrepView['defaultLanguage'];
/** What `selected` holds on the summary screen; question ids are "q1", "q2", … */
const SUMMARY = '#summary';

/** Text typed for a question of a set that has since been replaced elsewhere. */
interface OrphanDraft { key: string; question: string; text: string }

/** It belongs to no question any more, so it is only offered for copying, until the person removes it. */
function OrphanDrafts({ drafts, language, onDismiss }: { drafts: readonly OrphanDraft[]; language?: InterviewLanguage; onDismiss: () => void }) {
  const { t } = useTranslation();
  return (
    <section className="card notice orphan-drafts">
      <p>{t('interview.orphanDrafts.title')}</p>
      {drafts.map((d) => (
        <div key={d.key} className="feedback-block">
          <p className="muted prep-text" lang={language}>{d.question}</p>
          <p className="prep-text">{d.text}</p>
        </div>
      ))}
      <div className="btn-row"><button type="button" className="btn ghost" onClick={onDismiss}>{t('interview.orphanDrafts.dismiss')}</button></div>
    </section>
  );
}

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
      <LanguageChoice value={language} disabled={working} onChange={setLanguage} />
      {error ? <ErrorBanner error={error} /> : null}
      {working
        ? <ClaudeWorking textKey="interview.creating" onCancel={() => abort.current?.abort()} />
        : <div className="btn-row"><button type="button" className="btn" onClick={() => void start()}>{t('interview.create')}</button></div>}
    </div>
  );
}

function PrepOverview({ id, prep, readOnly, onOpen, onSummary, onReplaced, onRefresh }: {
  id: string;
  prep: InterviewPrep;
  readOnly: boolean;
  onOpen: (id: string) => void;
  onSummary: () => void;
  onReplaced: (view: InterviewPrepView) => void;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  const [replace, setReplace] = useState<ReplaceState>('idle');
  // One click elsewhere would leave this screen, and leaving cancels the work.
  const generating = replace === 'working';
  const done = prep.questions.filter(isFinished).length;
  const next = nextQuestion(prep.questions);
  // A closed application cannot ask for a summary any more: only one that exists can be opened.
  const canOpenSummary = !next && (!readOnly || prep.summary !== null);
  return (
    <>
      <div className="question-progress">
        <div>
          <strong>{t('interview.progress', { done, total: prep.questions.length })}</strong>
          <p className="muted">{t('interview.languageLine', { language: t(`interview.language.${prep.language}`) })}</p>
        </div>
        {!readOnly && next ? <button type="button" className="btn" disabled={generating} onClick={() => onOpen(next.id)}>{t('interview.continue')}</button> : null}
        {canOpenSummary ? <button type="button" className="btn" disabled={generating} onClick={onSummary}>{t('interview.summary.open')}</button> : null}
      </div>
      {readOnly ? <p className="notice" role="status">{t('interview.readOnly')}</p> : null}
      {readOnly ? null : <NewQuestions applicationId={id} proposal={prep.language === 'de' ? 'en' : 'de'} labelKey="interview.newQuestions.changeLanguage" onReplaced={onReplaced} onRefresh={onRefresh} onStateChange={setReplace} />}
      <QuestionCards questions={prep.questions} readOnly={readOnly} disabled={generating} onOpen={onOpen} />
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
  // "Repeat all weak": the weak questions still to come; Next goes through them before anything else.
  const [repeatQueue, setRepeatQueue] = useState<readonly string[]>([]);
  // Drafts live here so that going back to the cards keeps them, and the leave warning still knows about them.
  const [drafts, setDrafts] = useState<Readonly<Record<string, string>>>({});
  const [orphans, setOrphans] = useState<readonly OrphanDraft[]>([]);

  // Read by callbacks that must stay stable, and written only where the state changes.
  const shown = useRef<InterviewPrepView | null>(null);
  const draftsNow = useRef<Readonly<Record<string, string>>>({});
  const replaceDrafts = useCallback((next: Readonly<Record<string, string>>) => {
    draftsNow.current = next;
    setDrafts(next);
  }, []);
  const leaveOldSet = useCallback(() => {
    replaceDrafts({});
    setRepeatQueue([]);
    setSelected(null);
  }, [replaceDrafts]);

  /**
   * Ids repeat between sets, so a draft must never land on a different question. A set replaced elsewhere (another tab) comes
   * as a surprise: what the person had typed and not sent stays on screen to copy.
   */
  const applyView = useCallback((next: InterviewPrepView) => {
    const before = shown.current;
    if (before && (before.prep?.createdAt ?? null) !== (next.prep?.createdAt ?? null)) {
      const old = before.prep;
      const unsent = (old?.questions ?? [])
        .filter((q) => isDraftUnsaved(q, draftsNow.current[q.id]) && draftsNow.current[q.id].trim() !== '')
        .map((q) => ({ key: `${old?.createdAt}|${q.id}`, question: q.text, text: draftsNow.current[q.id] }));
      if (unsent.length > 0) setOrphans((prev) => [...prev, ...unsent]);
      leaveOldSet();
    }
    shown.current = next;
    setView(next);
  }, [leaveOldSet]);

  /** This page's own, confirmed replacement: the person was warned that unsent text goes too, so nothing is kept. */
  const applyReplaced = useCallback((next: InterviewPrepView) => {
    leaveOldSet();
    shown.current = next;
    setView(next);
  }, [leaveOldSet]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [prepView, appView] = await Promise.all([api.interview(id), api.getApplication(id)]);
      applyView(prepView);
      setApplication(appView.application);
    } catch (err) {
      setError(err);
    }
  }, [id, applyView]);
  useEffect(() => { void load(); }, [load]);

  const setDraft = (questionId: string, text: string | null) => {
    const next = { ...draftsNow.current };
    if (text === null) delete next[questionId]; else next[questionId] = text;
    replaceDrafts(next);
  };
  useReportUnsaved(orphans.length > 0 || (view?.prep?.questions.some((q) => isDraftUnsaved(q, drafts[q.id])) ?? false));

  /** Quietly: the page keeps working on what it has if this fails. */
  const refresh = useCallback(() => { api.interview(id).then(applyView).catch(() => {}); }, [id, applyView]);
  const openQuestion = (questionId: string) => { setRepeatQueue([]); setSelected(questionId); };
  const backToCards = () => { setRepeatQueue([]); setSelected(null); };

  const prep = view?.prep ?? null;
  const question = prep?.questions.find((q) => q.id === selected) ?? null;
  const allDone = prep?.questions.every(isFinished) ?? false;
  // Never before the whole set has feedback, and for a closed application only a summary that exists.
  const showSummary = selected === SUMMARY && allDone && (!view?.readOnly || prep?.summary != null);

  // A new screen starts at its top, under the top bar. The same screen stays where it is: typing or a failed request must not move it.
  const screenId = question?.id ?? (showSummary ? SUMMARY : 'cards');
  const lastScreen = useRef(screenId);
  useEffect(() => {
    if (lastScreen.current === screenId) return;
    lastScreen.current = screenId;
    window.scrollTo?.(0, 0);
  }, [screenId]);

  if (error) return <ErrorBanner error={error} onRetry={() => void load()} />;
  if (!view || !application) return <p className="muted">{t('common.loading')}</p>;

  const next = (currentId: string) => {
    if (repeatQueue.length > 0) {
      setSelected(repeatQueue[0]);
      setRepeatQueue(repeatQueue.slice(1));
      return;
    }
    const open = prep ? nextAfter(prep.questions, currentId) : null;
    setSelected(open ?? (allDone ? SUMMARY : null));
  };
  const repeatWeak = () => {
    const weak = prep?.questions.filter((q) => q.answer?.feedback?.weak).map((q) => q.id) ?? [];
    setSelected(weak[0] ?? null);
    setRepeatQueue(weak.slice(1));
  };
  return (
    <section>
      <p><a href={`#/applications/${id}`}>{t('interview.back')}</a></p>
      <h1>{t('interview.title')}</h1>
      <p className="muted">{application.vacancy.company} — {application.vacancy.title}</p>
      {orphans.length > 0 && !question && !showSummary ? <OrphanDrafts drafts={orphans} language={prep?.language} onDismiss={() => setOrphans([])} /> : null}
      {question && prep ? (
        <AnswerView
          key={question.id}
          applicationId={id}
          setCreatedAt={prep.createdAt}
          question={question}
          language={prep.language}
          readOnly={view.readOnly}
          draft={drafts[question.id]}
          onDraft={(text) => setDraft(question.id, text)}
          onView={applyView}
          onRefresh={refresh}
          onNext={() => next(question.id)}
          onBack={backToCards}
        />
      ) : prep && showSummary ? (
        <SummaryView
          applicationId={id}
          prep={prep}
          readOnly={view.readOnly}
          onView={applyView}
          onReplaced={applyReplaced}
          onRefresh={refresh}
          onOpen={openQuestion}
          onRepeatWeak={repeatWeak}
          onBack={backToCards}
        />
      ) : prep ? <PrepOverview id={id} prep={prep} readOnly={view.readOnly} onOpen={openQuestion} onSummary={() => setSelected(SUMMARY)} onReplaced={applyReplaced} onRefresh={refresh} />
          : view.canStart ? <StartPrep id={id} view={view} onView={applyView} />
            : <p className="notice" role="status">{t('interview.notAvailable')}</p>}
    </section>
  );
}
