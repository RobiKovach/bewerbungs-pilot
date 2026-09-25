import { useTranslation } from 'react-i18next';
import { DocumentsEditor } from '../DocumentsEditor';
import { PhotoEditor } from '../PhotoEditor';
import { NextButton } from '../unsaved';
import type { WizardStepProps } from './types';

export function FilesStep({ onNext, nextLabelKey = 'profile.wizard.finish' }: WizardStepProps) {
  const { t } = useTranslation();
  return (
    <>
      <p>{t('profile.files.intro')}</p>
      <PhotoEditor />
      <DocumentsEditor />
      <NextButton onNext={onNext} labelKey={nextLabelKey} />
    </>
  );
}
