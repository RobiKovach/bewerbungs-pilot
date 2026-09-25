import { useTranslation } from 'react-i18next';

export function HomePage() {
  const { t } = useTranslation();
  return (
    <section>
      <h1>{t('home.title')}</h1>
      <p className="lead">{t('home.intro')}</p>
      <div className="card">
        <h2>{t('home.nextTitle')}</h2>
        <p>{t('home.nextBody')}</p>
        <div className="btn-row">
          <a className="btn" href="#/guide">{t('home.openGuide')}</a>
          <a className="btn ghost" href="#/profile">{t('home.openProfile')}</a>
        </div>
      </div>
    </section>
  );
}
