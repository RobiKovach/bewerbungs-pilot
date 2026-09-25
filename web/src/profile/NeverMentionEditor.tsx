import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { ErrorBanner } from '../components/ErrorBanner';
import { LIMITS } from './constants';
import { LinesField } from './fields';
import { useProfile } from './ProfileContext';
import { useReportUnsaved } from './unsaved';

export function NeverMentionEditor() {
  const { t } = useTranslation();
  const { view, apply } = useProfile();
  const [lines, setLines] = useState(view.profile.neverMention);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const tooMany = lines.length > LIMITS.neverMention;
  // The server drops duplicates, so compare the same way — otherwise a saved list with a repeat would stay "unsaved".
  useReportUnsaved(JSON.stringify([...new Set(lines)]) !== JSON.stringify(view.profile.neverMention));

  const save = async () => {
    setError(null);
    try {
      apply(await api.setNeverMention(lines));
      setSaved(true);
    } catch (err) {
      setError(err);
    }
  };

  return (
    <div className="card">
      <LinesField label={t('profile.stories.neverTitle')} hint={t('profile.stories.neverHint')} value={lines} maxLines={LIMITS.neverMention}
        onChange={(v) => { setLines(v); setSaved(false); }} />
      <div className="btn-row">
        <button type="button" className="btn ghost" disabled={tooMany} onClick={() => void save()}>{t('profile.stories.neverSave')}</button>
        {saved ? <span className="ok">✓ {t('profile.stories.saved')}</span> : null}
      </div>
      {error ? <ErrorBanner error={error} /> : null}
    </div>
  );
}
