import { useTranslation } from 'react-i18next';
import type { PersonalFinding } from '../types';

/** "There is personal data here that is not in your profile": a hint only, it never blocks Approve or Send. */
export function PersonalDataWarning({ warnings }: { warnings: PersonalFinding[] }) {
  const { t, i18n } = useTranslation();
  if (warnings.length === 0) return null;
  const place = (w: PersonalFinding) => {
    const where = w.where;
    const key = `applications.personalData.where.${where.part}.${where.field}`;
    // A place this version does not know (newer server, older page) gets a plain word, never a raw key.
    if (!i18n.exists(key)) return t('applications.personalData.where.other');
    return where.part === 'letter' ? t(key, { n: where.index ?? '' }) : t(key);
  };
  return (
    <div className="card notice notice-warn personal-data" role="status">
      <p><strong>{t('applications.personalData.title')}</strong></p>
      <ul>
        {warnings.map((w, i) => (
          <li key={i}>{`${t(`applications.personalData.kind.${w.kind}`)}: ${w.value} — ${place(w)}`}</li>
        ))}
      </ul>
      <p>{t('applications.personalData.hint')}</p>
    </div>
  );
}
