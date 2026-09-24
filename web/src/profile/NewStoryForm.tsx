import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { ErrorBanner } from '../components/ErrorBanner';
import type { StoryInput } from '../types';
import { useProfile } from './ProfileContext';
import { StoryForm } from './StoryCard';

const EMPTY: StoryInput = { title: '', text: '', kind: 'work', disclosure: 'ok' };

export function NewStoryForm() {
  const { t } = useTranslation();
  const { apply } = useProfile();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(EMPTY);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  if (!open) return <div className="btn-row"><button type="button" className="btn ghost" onClick={() => setOpen(true)}>{t('profile.stories.writeOwn')}</button></div>;

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      apply(await api.addStory({ ...draft, title: draft.title.trim(), text: draft.text.trim() }));
      setDraft(EMPTY);
      setOpen(false);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <StoryForm draft={draft} onChange={setDraft} />
      <div className="btn-row">
        <button type="button" className="btn" disabled={busy || !draft.title.trim() || !draft.text.trim()} onClick={() => void add()}>{t('profile.stories.addOwn')}</button>
        <button type="button" className="btn ghost" onClick={() => setOpen(false)}>{t('common.cancel')}</button>
      </div>
      {error ? <ErrorBanner error={error} /> : null}
    </div>
  );
}
