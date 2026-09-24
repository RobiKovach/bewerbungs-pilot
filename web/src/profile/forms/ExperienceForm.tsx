import { useTranslation } from 'react-i18next';
import type { ExperienceEntry } from '../../types';
import { EntryList } from '../EntryList';
import { TextField, YearMonthField } from '../fields';
import type { FormProps } from './types';

const create = (): ExperienceEntry => ({ id: crypto.randomUUID(), jobTitle: '', employer: '', city: '', country: '', from: '', to: '', description: '' });

export function ExperienceForm({ data, onChange, isAi }: FormProps<'experience'>) {
  const { t } = useTranslation();
  return (
    <EntryList items={data.items} onChange={(items) => onChange({ items })} create={create} addLabel={t('profile.sections.experience.add')}
      render={(e, update) => {
        const ai = (field: string) => isAi(`items.${e.id}.${field}`);
        return (
          <div className="form-grid">
            <TextField label={t('profile.entry.jobTitle')} value={e.jobTitle} ai={ai('jobTitle')} hint={t('profile.officialHint')} onChange={(jobTitle) => update({ jobTitle })} />
            <TextField label={t('profile.entry.employer')} value={e.employer} ai={ai('employer')} hint={t('profile.officialHint')} onChange={(employer) => update({ employer })} />
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
