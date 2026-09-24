import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { ErrorBanner } from '../components/ErrorBanner';
import type { ProfileView, Story, StoryInput } from '../types';
import { STORY_KINDS } from './constants';
import { SelectField, TextField } from './fields';
import { useProfile } from './ProfileContext';

const DISCLOSURES = ['ok', 'never'] as const;

export function StoryForm({ draft, onChange }: { draft: StoryInput; onChange: (d: StoryInput) => void }) {
  const { t } = useTranslation();
  return (
    <div className="form-grid">
      <TextField label={t('profile.stories.title')} value={draft.title} onChange={(title) => onChange({ ...draft, title })} />
      <SelectField label={t('profile.stories.kind')} value={draft.kind} options={STORY_KINDS} optionLabel={(k) => t(`profile.storyKind.${k}`)} onChange={(kind) => onChange({ ...draft, kind })} />
      <TextField multiline label={t('profile.stories.text')} value={draft.text} onChange={(text) => onChange({ ...draft, text })} />
      <SelectField label={t('profile.stories.disclosure')} value={draft.disclosure} options={DISCLOSURES} optionLabel={(d) => t(`profile.disclosure.${d}`)} onChange={(disclosure) => onChange({ ...draft, disclosure })} />
    </div>
  );
}

export function StoryCard({ story }: { story: Story }) {
  const { t } = useTranslation();
  const { apply } = useProfile();
  const [draft, setDraft] = useState<StoryInput>({ title: story.title, text: story.text, kind: story.kind, disclosure: story.disclosure });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const dirty = draft.title !== story.title || draft.text !== story.text || draft.kind !== story.kind || draft.disclosure !== story.disclosure;
  const valid = draft.title.trim() !== '' && draft.text.trim() !== '';

  const run = async (fn: () => Promise<ProfileView>) => {
    setBusy(true);
    setError(null);
    try { apply(await fn()); } catch (err) { setError(err); } finally { setBusy(false); }
  };

  return (
    <div className="card story">
      {!story.confirmed ? <p><span className="badge ai">{t('profile.stories.new')}</span></p> : null}
      <StoryForm draft={draft} onChange={setDraft} />
      <div className="btn-row">
        {!story.confirmed || dirty ? (
          <button type="button" className="btn" disabled={!valid || busy} onClick={() => void run(() => api.saveStory(story.id, { ...draft, confirmed: true }))}>
            {story.confirmed ? t('profile.stories.save') : t('profile.stories.confirm')}
          </button>
        ) : null}
        <button type="button" className="btn ghost" disabled={busy}
          onClick={() => (confirmDelete ? void run(() => api.deleteStory(story.id)) : setConfirmDelete(true))}>
          {confirmDelete ? t('profile.stories.reallyDelete') : t('profile.stories.delete')}
        </button>
      </div>
      {error ? <ErrorBanner error={error} /> : null}
    </div>
  );
}
