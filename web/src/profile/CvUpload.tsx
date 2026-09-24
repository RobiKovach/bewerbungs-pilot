import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../api';
import { ErrorBanner } from '../components/ErrorBanner';
import { InfoTip } from '../components/InfoTip';
import type { CvResult } from '../types';
import { ClaudeWorking } from './ClaudeWorking';
import { MAX_BYTES } from './constants';
import { useProfile } from './ProfileContext';
import { useCancellable } from './useCancellable';

export function CvUpload({ onDone, replace = false }: { onDone: (result: CvResult) => void; replace?: boolean }) {
  const { t } = useTranslation();
  const { apply } = useProfile();
  const call = useCancellable();
  const inputId = useId();

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_BYTES.cv) {
      call.fail(new ApiError('FILE_TOO_LARGE', `${file.size} bytes`));
      return;
    }
    const result = await call.run((signal) => api.uploadCv(file, signal));
    if (result) {
      apply(result);
      onDone(result);
    }
  };

  if (call.state.kind === 'running') return <ClaudeWorking textKey="profile.cv.reading" onCancel={call.cancel} />;
  return (
    <>
      <div className="btn-row">
        <label className="btn" htmlFor={inputId}>{replace ? t('profile.cv.replace') : t('profile.cv.upload')}</label>
        <InfoTip textKey="info.profileCv" />
      </div>
      <input id={inputId} type="file" className="visually-hidden"
        accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
      {call.state.kind === 'failed' ? <ErrorBanner error={call.state.error} /> : null}
    </>
  );
}
