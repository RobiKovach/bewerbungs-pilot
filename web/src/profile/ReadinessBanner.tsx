import { useTranslation } from 'react-i18next';
import type { Readiness } from '../types';

export function ReadinessBanner({ readiness }: { readiness: Readiness }) {
  const { t } = useTranslation();
  return (
    <div className="card readiness">
      {readiness.ready ? (
        <p className="ok"><span aria-hidden="true">✓ </span>{t('profile.ready')}</p>
      ) : (
        <>
          <p><strong>{t('profile.notReady')}</strong></p>
          <ul>{readiness.missing.map((id) => <li key={id}>{t(`profile.sections.${id}.title`)}</li>)}</ul>
        </>
      )}
      {readiness.warnings.includes('noStories') ? <p className="muted">{t('profile.noStoriesWarning')}</p> : null}
    </div>
  );
}
