import { useTranslation } from 'react-i18next';
import type { PersonalData } from '../../types';
import { TextField } from '../fields';
import { LinksField } from '../LinksField';
import type { FormProps } from './types';

const TEXT_FIELDS = ['fullName', 'email', 'phone', 'street', 'postalCode', 'city', 'country', 'nationality', 'workPermit', 'drivingLicense'] as const satisfies readonly (keyof PersonalData)[];

export function PersonalForm({ data, onChange, isAi }: FormProps<'personal'>) {
  const { t } = useTranslation();
  const set = (key: keyof PersonalData) => (v: string) => onChange({ ...data, [key]: v });
  return (
    <div className="form-grid">
      {TEXT_FIELDS.map((k) => (
        <TextField key={k} label={t(`profile.personal.${k}`)} value={data[k]} ai={isAi(k)} type={k === 'email' ? 'email' : 'text'} onChange={set(k)} />
      ))}
      <TextField label={t('profile.personal.birthDate')} value={data.birthDate} ai={isAi('birthDate')} type="date" onChange={set('birthDate')} />
      <LinksField value={data.links} ai={isAi('links')} onChange={(links) => onChange({ ...data, links })} />
    </div>
  );
}
