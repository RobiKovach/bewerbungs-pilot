import { useTranslation } from 'react-i18next';
import type { SkillItem } from '../../types';
import { SKILL_LEVELS } from '../constants';
import { EntryList } from '../EntryList';
import { SelectField, TextField } from '../fields';
import type { FormProps } from './types';

const create = (): SkillItem => ({ id: crypto.randomUUID(), name: '', level: '' });

export function SkillsForm({ data, onChange, isAi }: FormProps<'skills'>) {
  const { t } = useTranslation();
  return (
    <EntryList items={data.items} onChange={(items) => onChange({ items })} create={create} addLabel={t('profile.sections.skills.add')}
      render={(s, update) => (
        <div className="form-grid">
          <TextField label={t('profile.entry.skill')} value={s.name} ai={isAi(`items.${s.id}.name`)} onChange={(name) => update({ name })} />
          <SelectField label={t('profile.entry.level')} value={s.level} options={SKILL_LEVELS} ai={isAi(`items.${s.id}.level`)}
            optionLabel={(l) => t(`profile.skillLevel.${l || 'none'}`)} onChange={(level) => update({ level })} />
        </div>
      )} />
  );
}
