import { useTranslation } from 'react-i18next';
import { EMPLOYMENT_TYPES, LIMITS, REMOTE_PREFERENCES } from '../constants';
import { CheckboxGroup, LinesField, NumberField, SelectField, TextField } from '../fields';
import type { FormProps } from './types';

export function WishesForm({ data, onChange, isAi }: FormProps<'wishes'>) {
  const { t } = useTranslation();
  return (
    <div className="form-grid">
      <LinesField label={t('profile.wishes.jobTitles')} value={data.jobTitles} ai={isAi('jobTitles')} maxLines={LIMITS.lines} onChange={(jobTitles) => onChange({ ...data, jobTitles })} />
      <LinesField label={t('profile.wishes.locations')} value={data.locations} ai={isAi('locations')} maxLines={LIMITS.lines} onChange={(locations) => onChange({ ...data, locations })} />
      <NumberField label={t('profile.wishes.radiusKm')} value={data.radiusKm} max={1000} ai={isAi('radiusKm')} onChange={(radiusKm) => onChange({ ...data, radiusKm })} />
      <SelectField label={t('profile.wishes.remote')} value={data.remote} options={REMOTE_PREFERENCES} optionLabel={(r) => t(`profile.remote.${r}`)} ai={isAi('remote')} onChange={(remote) => onChange({ ...data, remote })} />
      <CheckboxGroup legend={t('profile.wishes.employmentTypes')} values={EMPLOYMENT_TYPES} selected={data.employmentTypes}
        optionLabel={(e) => t(`profile.employment.${e}`)} ai={isAi('employmentTypes')} onChange={(employmentTypes) => onChange({ ...data, employmentTypes })} />
      <label className="checkbox-field">
        <input type="checkbox" checked={data.includeTemporaryAgencies}
          onChange={(e) => onChange({ ...data, includeTemporaryAgencies: e.target.checked })} />
        <span>
          {t('profile.wishes.includeTemporaryAgencies')}
          <small className="muted">{t('profile.wishes.includeTemporaryAgenciesHint')}</small>
        </span>
      </label>
      <NumberField label={t('profile.wishes.salaryMinEur')} value={data.salaryMinEur} max={1_000_000} ai={isAi('salaryMinEur')} onChange={(salaryMinEur) => onChange({ ...data, salaryMinEur })} />
      <TextField label={t('profile.wishes.availableFrom')} type="date" value={data.availableFrom} ai={isAi('availableFrom')} onChange={(availableFrom) => onChange({ ...data, availableFrom })} />
      <TextField multiline label={t('profile.wishes.notes')} value={data.notes} ai={isAi('notes')} onChange={(notes) => onChange({ ...data, notes })} />
    </div>
  );
}
