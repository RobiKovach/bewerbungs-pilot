import { useTranslation } from 'react-i18next';
import type { PersonalFinding } from '../types';

/** "There is personal data here that is not in your profile": a hint only, it never blocks Approve or Send. */
export function PersonalDataWarning({ warnings }: { warnings: PersonalFinding[] }) {
  const { t } = useTranslation();
  if (warnings.length === 0) return null;
  const place = (w: PersonalFinding) => {
    const where = w.where;
    if (where.part === 'letter') return t(`applications.personalData.where.letter.${where.field}`, { n: where.index ?? '' });
    if (where.part === 'cv') return t(`applications.personalData.where.cv.${where.field}`);
    return t(`applications.personalData.where.email.${where.field}`);
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
