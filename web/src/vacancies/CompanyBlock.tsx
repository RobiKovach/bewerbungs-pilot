import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { ErrorBanner } from '../components/ErrorBanner';
import { WrittenBy } from '../components/WrittenBy';
import type { CompanyResearch, ResearchPoint, Vacancy } from '../types';

/** While the research is queued or running, the card asks the server again this often. */
export const RESEARCH_POLL_MS = 2000;

const date = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split('-'); return `${d}.${m}.${y}`; };
const host = (url: string) => { try { return new URL(url).hostname; } catch { return url; } };
const isHttp = (url: string) => /^https?:\/\//i.test(url);
const busyState = (r: CompanyResearch | undefined) => r?.state === 'queued' || r?.state === 'running';
const hasContent = (r: CompanyResearch) => Boolean(r.website || r.about || r.news.length || r.redFlags.length || r.facts.length);

function SourceLink({ url }: { url: string }) {
  if (!isHttp(url)) return null;
  return <> <a className="company__source" href={url} target="_blank" rel="noopener noreferrer">{host(url)} ↗</a></>;
}

function Section({ title, children }: { title: ReactNode; children: ReactNode }) {
  return <div className="company__section"><h4>{title}</h4>{children}</div>;
}

/**
 * "About the company" on a vacancy card (0.13.0, spec 3.1): what the app found on the company's own pages and in the
 * news. Red flags are only for the person; facts can be taken out of the letter.
 */
export function CompanyBlock({ vacancy: v, onChange, pollMs = RESEARCH_POLL_MS }: {
  vacancy: Vacancy; onChange: (v: Vacancy) => void;
  /** Tests ask more often; the app uses RESEARCH_POLL_MS. */
  pollMs?: number;
}) {
  const { t, i18n } = useTranslation();
  const r = v.research;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [website, setWebsite] = useState('');
  const polling = busyState(r);
  // Bumped when an action starts and when it ends: a poll asked before that may answer after the action and must not
  // put a stale "running" back (e.g. right after Stop).
  const generation = useRef(0);

  useEffect(() => {
    if (!polling) return undefined;
    let stopped = false;
    const timer = window.setInterval(() => {
      // A failed poll is quiet: the next one tries again.
      const asked = generation.current;
      void api.listVacancies().then((list) => {
        const fresh = list.vacancies.find((x) => x.id === v.id);
        if (!stopped && fresh && asked === generation.current) onChange(fresh);
      }).catch(() => undefined);
    }, pollMs);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [polling, v.id, onChange, pollMs]);

  /** Runs one action; true when it worked (a refused one shows its error and changes nothing). */
  const act = async (fn: () => Promise<{ vacancy: Vacancy }>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    generation.current++;
    try {
      const { vacancy } = await fn();
      generation.current++;
      onChange(vacancy);
      return true;
    } catch (err) {
      setError(err);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const start = () => act(() => api.startResearch(v.id));
  const saveWebsite = (e: FormEvent) => {
    e.preventDefault();
    const url = website.trim();
    if (!url) return;
    // A refused address (blocked, invalid) stays in the field so the person can correct it.
    void act(() => api.setResearchWebsite(v.id, url)).then((ok) => { if (ok) setWebsite(''); });
  };

  const againButton = (
    <button type="button" className="btn small ghost" disabled={busy} onClick={() => void start()}>{t('vacancies.company.researchAgain')}</button>
  );
  const nothing = <p className="muted">{t('vacancies.company.nothing')}</p>;

  const points = (list: ResearchPoint[], facts: boolean) => (list.length === 0 ? nothing : (
    <ul className="company__points">
      {list.map((p) => (
        <li key={p.id} className={p.hidden ? 'company__point--hidden' : undefined}>
          <span>{p.text}</span><SourceLink url={p.sourceUrl} />
          {facts ? (
            p.hidden ? (
              <> <span className="badge">{t('vacancies.company.factHidden')}</span>{' '}
                <button type="button" className="btn small ghost" disabled={busy} onClick={() => void act(() => api.hideFact(v.id, p.id, false))}>{t('vacancies.company.factShow')}</button></>
            ) : (
              <> <button type="button" className="btn small ghost company__hide" disabled={busy} aria-label={t('vacancies.company.factHide')} title={t('vacancies.company.factHide')}
                onClick={() => void act(() => api.hideFact(v.id, p.id, true))}>×</button></>
            )
          ) : null}
        </li>
      ))}
    </ul>
  ));

  let body: ReactNode;
  if (!r) {
    body = <p><button type="button" className="btn small ghost" disabled={busy} onClick={() => void start()}>{t('vacancies.company.research')}</button></p>;
  } else {
    const status = r.state === 'running' || r.state === 'queued' ? (
      <p className="muted company__status" role="status">
        {t(r.state === 'running' ? 'vacancies.company.running' : 'vacancies.company.queued')}{' '}
        <button type="button" className="btn small ghost" disabled={busy} onClick={() => void act(() => api.stopResearch(v.id))}>{t('vacancies.company.stop')}</button>
      </p>
    ) : r.state === 'failed' ? (
      <p className="muted company__status">{t('vacancies.company.failed')} {againButton}</p>
    ) : null;
    const showDetails = r.state === 'done' || (!polling && hasContent(r));
    body = (
      <>
        {status}
        {showDetails ? (
          <details className="company__details">
            <summary>{t('vacancies.company.title')}</summary>
            <Section title={t('vacancies.company.website')}>
              {r.website && isHttp(r.website) ? (
                <p><a href={r.website} target="_blank" rel="noopener noreferrer">{host(r.website)} ↗</a></p>
              ) : (
                <form className="company__website" onSubmit={saveWebsite}>
                  <p className="muted">{t('vacancies.company.websiteNone')}</p>
                  <label className="field">
                    <span>{t('vacancies.company.websiteLabel')}</span>
                    <input type="url" inputMode="url" value={website} maxLength={2000} placeholder="https://" onChange={(e) => setWebsite(e.target.value)} />
                  </label>
                  <button type="submit" className="btn small" disabled={busy || !website.trim()}>{t('vacancies.company.websiteSave')}</button>
                </form>
              )}
            </Section>
            <Section title={t('vacancies.company.about')}>{r.about ? <p>{r.about}</p> : nothing}</Section>
            {/* News off (0.13.0): nothing was looked up, so there is no news section at all. */}
            {r.newsOff ? null : (
            <Section title={t('vacancies.company.news')}>
              {r.news.length ? (
                <ul className="company__points">
                  {r.news.map((n) => (
                    <li key={n.url}>
                      {n.date ? <span className="muted">{date(n.date)} · </span> : null}
                      {isHttp(n.url) ? <a href={n.url} target="_blank" rel="noopener noreferrer">{n.title}</a> : <span>{n.title}</span>}
                      {n.source ? <span className="muted"> · {n.source}</span> : null}
                    </li>
                  ))}
                </ul>
              ) : r.newsFailed ? <p className="muted">{t('vacancies.company.newsFailed')}</p> : nothing}
            </Section>
            )}
            <Section title={<>{t('vacancies.company.flags')} <span className="badge">{t('vacancies.company.flagsNote')}</span></>}>
              {points(r.redFlags, false)}
              {v.company.trim() ? (
                <p><a href={`https://www.kununu.com/de/search?q=${encodeURIComponent(v.company.trim())}`} target="_blank" rel="noopener noreferrer">{t('vacancies.company.kununu')}</a></p>
              ) : null}
            </Section>
            <Section title={t('vacancies.company.facts')}>{points(r.facts, true)}</Section>
            {r.state === 'done' ? (
              <p className="muted company__footer">
                {r.finishedAt ? t('vacancies.company.researchedAt', { date: date(r.finishedAt) }) : null}
                {r.provider ? <> · <WrittenBy provider={r.provider} kind="research" /></> : null}
                {/* Written once, in the interface language of that moment (as the score's points, 0.8.2). */}
                {r.language && r.language !== i18n.language ? <> {t('vacancies.card.otherLanguage')}</> : null}
                {' '}{againButton}
              </p>
            ) : null}
          </details>
        ) : null}
      </>
    );
  }

  return (
    <section className="company" aria-label={t('vacancies.company.title')}>
      {body}
      {error ? <ErrorBanner error={error} /> : null}
    </section>
  );
}
