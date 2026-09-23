import { useTranslation } from 'react-i18next';

export function QuitScreen() {
  const { t } = useTranslation();
  return (
    <div className="boot">
      <div className="card">
        <h1>{t('quit.title')}</h1>
        <p>{t('quit.body')}</p>
      </div>
    </div>
  );
}
