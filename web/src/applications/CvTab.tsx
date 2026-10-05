import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { ErrorBanner } from '../components/ErrorBanner';
import { TextField } from '../profile/fields';
import type { ApplicationView } from '../types';
import { PreviewFrame } from './PreviewFrame';

/** `locked`: a job works on this package (editing off). `busy`: any package job runs (Claude buttons off). `onDirty`: reports an unsaved Profil edit to the editor. */
export function CvTab({ view, locked, busy, onView, onRefresh, onDirty }: { view: ApplicationView; locked: boolean; busy: boolean; onView: (v: ApplicationView) => void; onRefresh: (keepProfil: boolean, keepHeadline: boolean) => void; onDirty: (dirty: boolean) => void }) {
  const { t } = useTranslation();
  const a = view.application;
  const [profil, setProfil] = useState(a.cv.profil);
  const [headline, setHeadline] = useState(a.cv.headline);
  const [asking, setAsking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const profilChanged = profil.trim() !== a.cv.profil;
  const headlineChanged = headline.trim() !== a.cv.headline;
  const dirty = profilChanged || headlineChanged;
  const handEdited = a.cv.profilEditedByHand || a.cv.headlineEditedByHand;
  const canSave = (!profilChanged || profil.trim() !== '') && (!headlineChanged || headline.trim() !== '');
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);
  // The question belongs to a clean Profil: typing closes it, so the remount after the job can never drop the edit.
  const asked = asking && view.profileChanged && !dirty;
  useEffect(() => {
    if (!asked) setAsking(false);
  }, [asked]);
  const save = async () => {
    setError(null);
    setSaving(true);
    try {
      let result: ApplicationView | null = null;
      if (headlineChanged) result = await api.patchHeadline(a.id, headline.trim());
      if (profilChanged) result = await api.patchProfil(a.id, profil.trim());
      if (result) onView(result);
    } catch (err) { setError(err); } finally { setSaving(false); }
  };
  return (
    <div className="letter-tab">
      <div>
        {view.profileChanged ? (
          <div className="notice card">
            <p>{t('applications.cv.profileChanged')}</p>
            {asked ? (
              <>
                <p>{t('applications.cv.keepQuestion')}</p>
                <div className="btn-row">
                  <button type="button" className="btn" disabled={busy || locked || dirty} onClick={() => { setAsking(false); onRefresh(true, true); }}>{t('applications.cv.keepYes')}</button>
                  <button type="button" className="btn ghost" disabled={busy || locked || dirty} onClick={() => { setAsking(false); onRefresh(false, false); }}>{t('applications.cv.keepNo')}</button>
                </div>
              </>
            ) : (
              <button type="button" className="btn" disabled={busy || locked || dirty} onClick={() => (handEdited ? setAsking(true) : onRefresh(false, false))}>{t('applications.cv.update')}</button>
            )}
          </div>
        ) : null}
        <fieldset disabled={locked} className="plain">
          <TextField label={t('applications.cv.headline')} value={headline} onChange={setHeadline} maxLength={80} hint={t('applications.cv.headlineHint')} />
          <TextField multiline label={t('applications.cv.profil')} value={profil} onChange={setProfil} maxLength={800} hint={t('applications.cv.profilHint')} />
        </fieldset>
        <div className="btn-row">
          <button type="button" className="btn" disabled={locked || saving || !dirty || !canSave} onClick={() => void save()}>{t('applications.cv.save')}</button>
          <button type="button" className="btn ghost" disabled={!dirty} onClick={() => { setProfil(a.cv.profil); setHeadline(a.cv.headline); }}>{t('applications.letter.discard')}</button>
        </div>
        <p className="muted">{t('applications.cv.fromProfile')} <a href="#/profile">{t('applications.cv.toProfile')}</a></p>
        {error ? <ErrorBanner error={error} /> : null}
      </div>
      <PreviewFrame id={a.id} kind="cv" version={a.updatedAt} title={t('applications.cv.preview')} />
    </div>
  );
}
