import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { ErrorBanner } from '../components/ErrorBanner';
import { LinesField, SelectField, TextField } from '../profile/fields';
import { useReportUnsaved } from '../profile/unsaved';
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
  const [phone, setPhone] = useState(v.contact?.phone ?? '');
  const [street, setStreet] = useState(v.contact?.street ?? '');
  const [postcode, setPostcode] = useState(v.contact?.postcode ?? '');
  const [city, setCity] = useState(v.contact?.city ?? '');
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const linkError = okLink(url) ? undefined : t('vacancies.edit.badLink');
  const [tried, setTried] = useState(false);
  useReportUnsaved(title !== v.title || company !== v.company || JSON.stringify(locations) !== JSON.stringify(v.locations) || url !== v.url
    || email !== (v.contact?.email ?? '') || salutation !== (v.contact?.salutation ?? '') || name !== (v.contact?.name ?? '')
    || phone !== (v.contact?.phone ?? '') || street !== (v.contact?.street ?? '') || postcode !== (v.contact?.postcode ?? '') || city !== (v.contact?.city ?? ''));

  const save = async () => {
    setTried(true);
    if (linkError || !title.trim()) return;
    setSaving(true);
    try {
      const c = { email: email.trim(), name: name.trim(), phone: phone.trim(), street: street.trim(), postcode: postcode.trim(), city: city.trim() };
      const contact = Object.values(c).some(Boolean) ? { ...c, salutation: c.name ? salutation : '' as Salutation } : null;
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
        <TextField label={t('vacancies.edit.phone')} value={phone} onChange={setPhone} maxLength={40} />
        <TextField label={t('vacancies.edit.street')} value={street} onChange={setStreet} maxLength={120} />
        <TextField label={t('vacancies.edit.postcode')} value={postcode} onChange={setPostcode} maxLength={10} />
        <TextField label={t('vacancies.edit.city')} value={city} onChange={setCity} maxLength={80} />
      </div>
      <div className="btn-row">
        <button type="button" className="btn" disabled={saving} onClick={() => void save()}>{t('vacancies.edit.save')}</button>
        <button type="button" className="btn ghost" onClick={onDone}>{t('common.cancel')}</button>
      </div>
      {error ? <ErrorBanner error={error} /> : null}
    </div>
  );
}
