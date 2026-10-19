import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorBanner } from '../components/ErrorBanner';
import { LIMITS } from '../profile/constants';
import { useSettings } from '../settings';
import type { PublishedWithinDays } from '../types';
import { useVacancies } from './VacanciesContext';

export const DAY_CHOICES: readonly PublishedWithinDays[] = [1, 3, 7, 14, 30];

/** Job titles edited right here; every change is saved to the profile's job wishes at once (one source of truth). */
function JobTitles({ disabled }: { disabled: boolean }) {
  const { t } = useTranslation();
  const { wishes, saveWishes } = useVacancies();
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const titles = wishes.jobTitles.filter((x) => x.trim());
  const full = titles.length >= LIMITS.lines;

  const save = async (jobTitles: string[]) => {
    setBusy(true);
    setError(null);
    try {
      await saveWishes({ ...wishes, jobTitles });
      return true;
    } catch (err) {
      setError(err);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const add = async (e: FormEvent) => {
    e.preventDefault();
    const title = draft.trim();
    if (!title) return;
    // The same title twice would only run the same search twice.
    if (titles.some((x) => x.trim().toLowerCase() === title.toLowerCase())) { setDraft(''); return; }
    if (await save([...titles, title])) setDraft('');
  };

  return (
    <div className="job-titles">
      <strong>{t('vacancies.strip.jobTitles')}</strong>
      <ul className="chips">
        {titles.map((x) => (
          <li key={x} className="chip">
            {x}
            <button type="button" className="chip__remove" aria-label={t('vacancies.strip.removeTitle', { title: x })}
              disabled={disabled || busy} onClick={() => void save(titles.filter((y) => y !== x))}>×</button>
          </li>
        ))}
      </ul>
      <form className="inline-field" onSubmit={(e) => void add(e)}>
        <input aria-label={t('vacancies.strip.newTitle')} placeholder={t('vacancies.strip.newTitle')} value={draft} maxLength={LIMITS.name}
          disabled={disabled || busy || full} onChange={(e) => setDraft(e.target.value)} />
        <button type="submit" className="btn small ghost" disabled={disabled || busy || full || !draft.trim()}>{t('vacancies.strip.addTitle')}</button>
      </form>
      {full ? <p className="muted">{t('vacancies.strip.titlesFull', { max: LIMITS.lines })}</p> : null}
      {error ? <ErrorBanner error={error} /> : null}
    </div>
  );
}

export function SearchStrip({ canSearch, searching, onSearch, onAdd }: { canSearch: boolean; searching: boolean; onSearch: () => void; onAdd: () => void }) {
  const { t } = useTranslation();
  const { settings, update } = useSettings();
  const { wishes } = useVacancies();
  const places = wishes.remote === 'remote'
    ? t('vacancies.strip.remoteOnly')
    : [wishes.locations.join(', '), wishes.radiusKm !== null ? `+${wishes.radiusKm} km` : ''].filter(Boolean).join(' ');
  const parts = [
    places,
    // "remote only" is already in `places`; "doesn't matter" says nothing worth showing.
    wishes.remote === 'remote' || wishes.remote === 'any' ? '' : t(`profile.remote.${wishes.remote}`),
    wishes.employmentTypes.map((e) => t(`profile.employment.${e}`)).join(', '),
  ].filter(Boolean);
  return (
    <div className="card search-strip" data-testid="search-strip">
      <JobTitles disabled={searching} />
      <p>
        <strong>{t('vacancies.strip.searchingFor')}</strong> {parts.join(' · ') || '—'}{' '}
        <a href="#/profile">{t('vacancies.strip.change')}</a>
      </p>
      <div className="btn-row">
        <label className="inline-field">
          {t('vacancies.strip.within')}{' '}
          <select aria-label={t('vacancies.strip.within')} value={String(settings.vacancies.publishedWithinDays)}
            onChange={(e) => void update({ vacancies: { publishedWithinDays: Number(e.target.value) as PublishedWithinDays } })}>
            {DAY_CHOICES.map((d) => <option key={d} value={String(d)}>{t(`vacancies.strip.days.${d}`)}</option>)}
          </select>
        </label>
        <button type="button" className="btn" disabled={!canSearch || searching} onClick={onSearch}>{t('vacancies.strip.search')}</button>
        <button type="button" className="btn ghost" onClick={onAdd}>{t('vacancies.strip.add')}</button>
      </div>
    </div>
  );
}
