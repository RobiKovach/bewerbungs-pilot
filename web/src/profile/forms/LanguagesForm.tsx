import { useTranslation } from 'react-i18next';
import type { LanguageItem } from '../../types';
import { LANGUAGE_LEVELS } from '../constants';
import { EntryList } from '../EntryList';
import { SelectField, TextField } from '../fields';
import type { FormProps } from './types';

const create = (): LanguageItem => ({ id: crypto.randomUUID(), language: '', level: '', certificate: '' });

export function LanguagesForm({ data, onChange, isAi }: FormProps<'languages'>) {
  const { t } = useTranslation();
  return (
    <EntryList items={data.items} onChange={(items) => onChange({ items })} create={create} addLabel={t('profile.sections.languages.add')}
      render={(l, update) => (
        <div className="form-grid">
          <TextField label={t('profile.entry.language')} value={l.language} ai={isAi(`items.${l.id}.language`)} onChange={(language) => update({ language })} />
          <SelectField label={t('profile.entry.level')} value={l.level} options={LANGUAGE_LEVELS} ai={isAi(`items.${l.id}.level`)}
            optionLabel={(v) => t(`profile.languageLevel.${v || 'none'}`)} onChange={(level) => update({ level })} />
          <TextField label={t('profile.entry.certificate')} value={l.certificate} ai={isAi(`items.${l.id}.certificate`)} hint={t('profile.officialHint')} onChange={(certificate) => update({ certificate })} />
        </div>
      )} />
  );
}
