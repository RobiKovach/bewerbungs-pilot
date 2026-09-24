import { useTranslation } from 'react-i18next';
import { GUIDE_STAGES } from '../guide/stages';

export function GuidePage() {
  const { t } = useTranslation();
  return (
    <section>
      <h1>{t('guide.title')}</h1>
      <p className="lead">{t('guide.intro')}</p>
      <ol className="stage-list">
        {GUIDE_STAGES.map((s, i) => (
          <li key={s.id} className="card stage">
            <div className="stage-icon" aria-hidden="true">{s.icon}</div>
            <div>
              <h2>
                <span className="stage-num">{i + 1}</span>
                {t(`guide.stages.${s.id}.title`)}{' '}
                {s.action === 'coming-soon' ? <span className="badge">{t('common.comingSoon')}</span> : null}
              </h2>
              <p><strong>{t('guide.whatLabel')}:</strong> {t(`guide.stages.${s.id}.what`)}</p>
              <p><strong>{t('guide.todoLabel')}:</strong> {t(`guide.stages.${s.id}.todo`)}</p>
              {typeof s.action === 'object' ? <a className="btn" href={s.action.href}>{t('guide.go')}</a> : null}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
