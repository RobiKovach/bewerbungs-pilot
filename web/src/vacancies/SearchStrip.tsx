import { useTranslation } from 'react-i18next';
import { useSettings } from '../settings';
import type { PublishedWithinDays } from '../types';
import { useVacancies } from './VacanciesContext';

export const DAY_CHOICES: readonly PublishedWithinDays[] = [1, 3, 7, 14, 30];

export function SearchStrip({ canSearch, searching, onSearch, onAdd }: { canSearch: boolean; searching: boolean; onSearch: () => void; onAdd: () => void }) {
  const { t } = useTranslation();
  const { settings, update } = useSettings();
  const { wishes } = useVacancies();
  const places = wishes.remote === 'remote'
    ? t('vacancies.strip.remoteOnly')
    : [wishes.locations.join(', '), wishes.radiusKm !== null ? `+${wishes.radiusKm} km` : ''].filter(Boolean).join(' ');
  const parts = [
    wishes.jobTitles.join(', '),
    places,
    // "remote only" is already in `places`; "doesn't matter" says nothing worth showing.
    wishes.remote === 'remote' || wishes.remote === 'any' ? '' : t(`profile.remote.${wishes.remote}`),
    wishes.employmentTypes.map((e) => t(`profile.employment.${e}`)).join(', '),
  ].filter(Boolean);
  return (
    <div className="card search-strip" data-testid="search-strip">
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
