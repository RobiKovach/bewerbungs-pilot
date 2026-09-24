import { useTranslation } from 'react-i18next';
import { CvUpload } from '../CvUpload';
import type { WizardStepProps } from './types';

export function StartStep({ onNext }: WizardStepProps) {
  const { t } = useTranslation();
  return (
    <>
      <p>{t('profile.start.intro')}</p>
      <div className="choice-grid">
        <div className="card">
          <h2>{t('profile.start.withCvTitle')}</h2>
          <p>{t('profile.start.withCvBody')}</p>
          <CvUpload onDone={() => onNext()} />
        </div>
        <div className="card">
          <h2>{t('profile.start.withoutCvTitle')}</h2>
          <p>{t('profile.start.withoutCvBody')}</p>
          <button type="button" className="btn ghost" onClick={onNext}>{t('profile.start.withoutCv')}</button>
        </div>
      </div>
    </>
  );
}
