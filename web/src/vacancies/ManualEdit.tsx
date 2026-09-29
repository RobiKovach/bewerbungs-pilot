import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { ErrorBanner } from '../components/ErrorBanner';
import { LinesField, SelectField, TextField } from '../profile/fields';
import type { Salutation, Vacancy } from '../types';
import { useVacancies } from './VacanciesContext';

const SALUTATIONS: readonly Salutation[] = ['', 'Frau', 'Herr'];
const okLink = (s: string) => s.trim() === '' || /^https?:\/\/\S+$/i.test(s.trim());

export function ManualEdit({ vacancy: v, checkHint, onDone }: { vacancy: Vacancy; checkHint: boolean; onDone: () => void }) {
  const { t } = useTranslation();
  const { put } = useVacancies();
  const [title, setTitle] = useState(v.title);
  const [company, setCompany] = useState(v.company);
  const [locations, setLocations] = useState(v.locations);
  const [url, setUrl] = useState(v.url);
  const [email, setEmail] = useState(v.contact?.email ?? '');
  const [salutation, setSalutation] = useState<Salutation>(v.contact?.salutation ?? '');
  const [name, setName] = useState(v.contact?.name ?? '');
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const linkError = okLink(url) ? undefined : t('vacancies.edit.badLink');
  const [tried, setTried] = useState(false);

  const save = async () => {
    setTried(true);
    if (linkError || !title.trim()) return;
    setSaving(true);
    try {
      const contact = email.trim() || name.trim() ? { email: email.trim(), salutation: name.trim() ? salutation : '' as Salutation, name: name.trim() } : null;
      put((await api.editVacancy(v.id, { title: title.trim(), company: company.trim(), locations, url: url.trim(), contact })).vacancy);
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="manual-edit">
      {checkHint ? <p className="badge ai">{t('vacancies.edit.checkHint')}</p> : null}
      <div className="form-grid">
        <TextField label={t('vacancies.edit.title')} value={title} onChange={setTitle} error={tried && !title.trim() ? t('vacancies.edit.titleRequired') : undefined} />
        <TextField label={t('vacancies.edit.company')} value={company} onChange={setCompany} />
        <LinesField label={t('vacancies.edit.locations')} value={locations} onChange={setLocations} maxLines={20} />
        <TextField label={t('vacancies.edit.link')} value={url} onChange={setUrl} error={tried ? linkError : undefined} />
        <TextField label={t('vacancies.edit.email')} value={email} onChange={setEmail} />
        <SelectField label={t('vacancies.edit.salutation')} value={salutation} options={SALUTATIONS} optionLabel={(s) => s || '—'} onChange={setSalutation} />
        <TextField label={t('vacancies.edit.name')} value={name} onChange={setName} />
      </div>
      <div className="btn-row">
        <button type="button" className="btn" disabled={saving} onClick={() => void save()}>{t('vacancies.edit.save')}</button>
        <button type="button" className="btn ghost" onClick={onDone}>{t('common.cancel')}</button>
      </div>
      {error ? <ErrorBanner error={error} /> : null}
    </div>
  );
}
