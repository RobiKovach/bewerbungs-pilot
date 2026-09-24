import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { ErrorBanner } from '../components/ErrorBanner';
import { LinesField } from './fields';
import { useProfile } from './ProfileContext';

export function NeverMentionEditor() {
  const { t } = useTranslation();
  const { view, apply } = useProfile();
  const [lines, setLines] = useState(view.profile.neverMention);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<unknown>(null);

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
      <LinesField label={t('profile.stories.neverTitle')} hint={t('profile.stories.neverHint')} value={lines} onChange={(v) => { setLines(v); setSaved(false); }} />
      <div className="btn-row">
        <button type="button" className="btn ghost" onClick={() => void save()}>{t('profile.stories.neverSave')}</button>
        {saved ? <span className="ok">✓ {t('profile.stories.saved')}</span> : null}
      </div>
      {error ? <ErrorBanner error={error} /> : null}
    </div>
  );
}
