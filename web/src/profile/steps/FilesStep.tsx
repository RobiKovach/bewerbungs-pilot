import { useTranslation } from 'react-i18next';
import { DocumentsEditor } from '../DocumentsEditor';
import { PhotoEditor } from '../PhotoEditor';
import type { WizardStepProps } from './types';

export function FilesStep({ onNext, nextLabelKey = 'profile.wizard.finish' }: WizardStepProps) {
  const { t } = useTranslation();
  return (
    <>
      <p>{t('profile.files.intro')}</p>
      <PhotoEditor />
      <DocumentsEditor />
      <div className="btn-row"><button type="button" className="btn" onClick={onNext}>{t(nextLabelKey)}</button></div>
    </>
  );
}
