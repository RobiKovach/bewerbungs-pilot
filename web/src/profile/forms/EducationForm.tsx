import { useTranslation } from 'react-i18next';
import type { EducationEntry } from '../../types';
import { EDUCATION_KINDS } from '../constants';
import { EntryList } from '../EntryList';
import { SelectField, TextField, YearMonthField } from '../fields';
import type { FormProps } from './types';

const create = (): EducationEntry => ({ id: crypto.randomUUID(), kind: 'school', degree: '', institution: '', city: '', country: '', from: '', to: '', description: '' });

export function EducationForm({ data, onChange, isAi }: FormProps<'education'>) {
  const { t } = useTranslation();
  return (
    <EntryList items={data.items} onChange={(items) => onChange({ items })} create={create} addLabel={t('profile.sections.education.add')}
      render={(e, update) => {
        const ai = (field: string) => isAi(`items.${e.id}.${field}`);
        return (
          <div className="form-grid">
            <SelectField label={t('profile.entry.kind')} value={e.kind} options={EDUCATION_KINDS} optionLabel={(k) => t(`profile.educationKind.${k}`)} ai={ai('kind')} onChange={(kind) => update({ kind })} />
            <TextField label={t('profile.entry.degree')} value={e.degree} ai={ai('degree')} hint={t('profile.officialHint')} onChange={(degree) => update({ degree })} />
            <TextField label={t('profile.entry.institution')} value={e.institution} ai={ai('institution')} hint={t('profile.officialHint')} onChange={(institution) => update({ institution })} />
            <TextField label={t('profile.entry.city')} value={e.city} ai={ai('city')} onChange={(city) => update({ city })} />
            <TextField label={t('profile.entry.country')} value={e.country} ai={ai('country')} onChange={(country) => update({ country })} />
            <YearMonthField label={t('profile.entry.from')} value={e.from} ai={ai('from')} onChange={(from) => update({ from })} />
            <YearMonthField label={t('profile.entry.to')} value={e.to} ai={ai('to')} onChange={(to) => update({ to })} />
            <TextField multiline label={t('profile.entry.description')} value={e.description} ai={ai('description')} onChange={(description) => update({ description })} />
          </div>
        );
      }} />
  );
}
