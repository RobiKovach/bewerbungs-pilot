import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { ErrorBanner } from '../components/ErrorBanner';
import { WrittenBy } from '../components/WrittenBy';
import { ClaudeWorking } from '../profile/ClaudeWorking';
import { useCancellable } from '../profile/useCancellable';
import type { SubmittedInfo, Vacancy } from '../types';
import { useVacancies } from './VacanciesContext';

const isHttp = (url: string) => /^https?:\/\//i.test(url);
const level = (value: number) => (value >= 80 ? 'good' : value >= 50 ? 'mid' : 'weak');
/** DD.MM.YYYY in every UI language, like the German job ads themselves ("YYYY-MM-DD" or an ISO timestamp in). */
const date = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split('-'); return `${d}.${m}.${y}`; };

/** `submitted`: the person applied to this vacancy (it sits in the "Submitted" tab): a badge and "Hide" instead of the New/Favourite buttons. */
export function VacancyCard({ vacancy: v, highlighted = false, onHidden, extra, submitted = null }: { vacancy: Vacancy; highlighted?: boolean; onHidden: (v: Vacancy) => void; extra?: ReactNode; submitted?: SubmittedInfo | null }) {
  const { t, i18n } = useTranslation();
  const { put } = useVacancies();
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [textOpen, setTextOpen] = useState(false);
  const scoring = useCancellable();

  const act = async (fn: () => Promise<{ vacancy: Vacancy }>, after?: (x: Vacancy) => void) => {
    setBusy(true);
    setError(null);
    try {
      const { vacancy } = await fn();
      put(vacancy);
      after?.(vacancy);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  const status = (s: 'new' | 'favorite' | 'hidden', after?: (x: Vacancy) => void) => act(() => api.setVacancyStatus(v.id, s), after);

  const toggleText = async () => {
    if (textOpen) { setTextOpen(false); return; }
    setTextOpen(true);
    try { setText((await api.vacancyText(v.id)).text); } catch (err) { setError(err); }
  };
  const reloadText = () => act(() => api.refreshVacancyText(v.id), async () => setText((await api.vacancyText(v.id)).text));
  const score = () => void scoring.run(async (signal) => put((await api.scoreVacancy(v.id, signal)).vacancy));

  const facts = [
    v.locations.join(', '),
    v.remote === 'unknown' ? '' : t(`vacancies.remote.${v.remote}`),
    v.publishedAt ? t('vacancies.card.published', { date: date(v.publishedAt) }) : '',
  ].filter(Boolean).join(' · ');

  return (
    <article id={`vacancy-${v.id}`} className={`card vacancy${highlighted ? ' vacancy--highlight' : ''}`}>
      <header className="vacancy__head">
        {v.scoreState === 'scored' && v.score ? (
          <span className={`score score--${level(v.score.value)}`} title={t('vacancies.card.scoreTitle')}>{v.score.value}</span>
        ) : <span className="score score--none" aria-hidden="true">…</span>}
        <div>
          <h3>{v.title}</h3>
          <p className="muted">
            {v.company}{v.addedManually ? <> <span className="badge">{t('vacancies.card.manual')}</span></> : null}
          </p>
          {facts ? <p className="muted">{facts}</p> : null}
          {submitted ? (
            <p><span className={`badge status-${submitted.via === 'mail' ? 'sent' : 'submitted'}`}>
              {t(submitted.via === 'mail' ? 'vacancies.card.sentOn' : 'vacancies.card.submittedOn', { date: date(submitted.at) })}
            </span></p>
          ) : null}
          {v.contact ? (
            <p className="muted">
              {t('vacancies.card.contact', { who: [v.contact.salutation, v.contact.name].filter(Boolean).join(' ') || '—', email: v.contact.email || '—' })}
            </p>
          ) : null}
        </div>
      </header>

      {v.score && v.scoreState === 'scored' ? (
        <ul className="vacancy__points">
          {v.score.why.map((p) => <li key={`w${p}`} className="why">✓ <span>{p}</span></li>)}
          {v.score.missing.map((p) => <li key={`m${p}`} className="missing">✗ <span>{p}</span></li>)}
        </ul>
      ) : null}

      <p className="muted vacancy__scoreline">
        <span>
          {v.scoreState === 'pending' ? t('vacancies.card.pending') : null}
          {v.scoreState === 'scored' && v.score ? <>{t('vacancies.card.scoredAt', { date: date(v.score.scoredAt) })} <WrittenBy provider={v.score.provider} kind="score" /></> : null}
          {/* The points are written once, in the interface language of that moment (null: a score from before 0.8.2). */}
          {v.scoreState === 'scored' && v.score?.language && v.score.language !== i18n.language ? <> {t('vacancies.card.otherLanguage')}</> : null}
          {v.scoreState === 'notScored' ? t('vacancies.card.notScored') : null}
          {v.scoreState === 'failed' ? t('vacancies.card.failed') : null}
        </span>
        {v.scoreState !== 'pending' && v.hasText && v.status !== 'hidden' && scoring.state.kind !== 'running' ? (
          <> <button type="button" className="btn small ghost" onClick={score}>
            {t(v.scoreState === 'scored' ? 'vacancies.card.scoreAgain' : 'vacancies.card.score')}
          </button></>
        ) : null}
      </p>
      {scoring.state.kind === 'running' ? <ClaudeWorking textKey="vacancies.card.scoring" onCancel={scoring.cancel} /> : null}
      {scoring.state.kind === 'failed' ? <ErrorBanner error={scoring.state.error} /> : null}

      <div className="btn-row">
        {v.status === 'new' && !submitted ? (
          <>
            <button type="button" className="btn" disabled={busy} onClick={() => void status('favorite')}>{t('vacancies.card.interesting')}</button>
            <button type="button" className="btn ghost" disabled={busy} onClick={() => void status('hidden', onHidden)}>{t('vacancies.card.notInteresting')}</button>
          </>
        ) : null}
        {v.status === 'favorite' && !submitted ? <button type="button" className="btn ghost" disabled={busy} onClick={() => void status('new')}>{t('vacancies.card.unfavorite')}</button> : null}
        {v.status === 'stale' && !submitted ? <button type="button" className="btn ghost" disabled={busy} onClick={() => void status('hidden')}>{t('vacancies.card.remove')}</button> : null}
        {submitted && v.status !== 'hidden' ? <button type="button" className="btn ghost" disabled={busy} onClick={() => void status('hidden', onHidden)}>{t('vacancies.card.hide')}</button> : null}
        {v.status === 'hidden' ? <button type="button" className="btn ghost" disabled={busy} onClick={() => void status('new')}>{t('vacancies.card.bringBack')}</button> : null}
        {v.status !== 'hidden' && isHttp(v.url) ? (
          <a className="btn ghost" href={v.url} target="_blank" rel="noopener noreferrer">{t('vacancies.card.original')}</a>
        ) : null}
        {v.status === 'new' || v.status === 'favorite' ? (
          <button type="button" className="btn ghost" aria-expanded={textOpen} onClick={() => void toggleText()}>
            {t(textOpen ? 'vacancies.card.hideText' : 'vacancies.card.showText')}
          </button>
        ) : null}
      </div>

      {textOpen ? (
        text === null ? <p className="muted">{t('common.loading')}</p>
          : text === '' ? (
            <p className="muted">
              {t('vacancies.card.noText')}{' '}
              {v.source === 'arbeitsagentur' ? <button type="button" className="btn small" disabled={busy} onClick={() => void reloadText()}>{t('vacancies.card.loadAgain')}</button> : null}
            </p>
          ) : <pre className="vacancy-text">{text}</pre>
      ) : null}
      {extra}
      {error ? <ErrorBanner error={error} /> : null}
    </article>
  );
}
