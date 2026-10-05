import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProfileLink } from '../types';
import { LINK_LABEL_SUGGESTIONS, LINK_LIMITS, LINK_URL } from './constants';

/** Up to 3 links (label + full address) for the CV's contact block. Empty rows are dropped by the form on save. */
export function LinksField({ value, onChange, ai }: { value: ProfileLink[]; onChange: (v: ProfileLink[]) => void; ai?: boolean }) {
  const { t } = useTranslation();
  const listId = useId();
  const set = (i: number, patch: Partial<ProfileLink>) => onChange(value.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const nextLabel = LINK_LABEL_SUGGESTIONS.find((s) => !value.some((l) => l.label === s)) ?? '';
  return (
    <fieldset className="links-field">
      <legend>{t('profile.links.title')}{ai ? <span className="badge ai">{t('profile.aiCheck')}</span> : null}</legend>
      <datalist id={listId}>{LINK_LABEL_SUGGESTIONS.map((s) => <option key={s} value={s} />)}</datalist>
      {value.map((l, i) => {
        const bad = l.url.trim() !== '' && !LINK_URL.test(l.url.trim());
        return (
          <div className="link-row" key={i}>
            <input aria-label={t('profile.links.label')} list={listId} maxLength={LINK_LIMITS.label} value={l.label} onChange={(e) => set(i, { label: e.target.value })} />
            <input aria-label={t('profile.links.url')} type="url" placeholder="https://" maxLength={LINK_LIMITS.url} value={l.url} aria-invalid={bad || undefined} onChange={(e) => set(i, { url: e.target.value })} />
            <button type="button" className="btn ghost small" onClick={() => onChange(value.filter((_, j) => j !== i))}>{t('profile.links.remove')}</button>
            {bad ? <p className="field-error">{t('profile.links.badUrl')}</p> : null}
          </div>
        );
      })}
      {value.length < LINK_LIMITS.count
        ? <button type="button" className="btn ghost small" onClick={() => onChange([...value, { label: nextLabel, url: '' }])}>{t('profile.links.add')}</button>
        : null}
    </fieldset>
  );
}
