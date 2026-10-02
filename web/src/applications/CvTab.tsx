import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { ErrorBanner } from '../components/ErrorBanner';
import { TextField } from '../profile/fields';
import type { ApplicationView } from '../types';
import { PreviewFrame } from './PreviewFrame';

/** `locked`: a job works on this package. `onDirty`: reports an unsaved Profil edit to the editor. */
export function CvTab({ view, locked, onView, onRefresh, onDirty }: { view: ApplicationView; locked: boolean; onView: (v: ApplicationView) => void; onRefresh: (keepProfil: boolean) => void; onDirty: (dirty: boolean) => void }) {
  const { t } = useTranslation();
  const a = view.application;
  const [profil, setProfil] = useState(a.cv.profil);
  const [asking, setAsking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const dirty = profil.trim() !== a.cv.profil;
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);
  const save = async () => {
    setError(null);
    setSaving(true);
    try { onView(await api.patchProfil(a.id, profil.trim())); } catch (err) { setError(err); } finally { setSaving(false); }
  };
  return (
    <div className="letter-tab">
      <div>
        {view.profileChanged ? (
          <div className="notice card">
            <p>{t('applications.cv.profileChanged')}</p>
            {asking ? (
              <>
                <p>{t('applications.cv.keepQuestion')}</p>
                <div className="btn-row">
                  <button type="button" className="btn" onClick={() => { setAsking(false); onRefresh(true); }}>{t('applications.cv.keepYes')}</button>
                  <button type="button" className="btn ghost" onClick={() => { setAsking(false); onRefresh(false); }}>{t('applications.cv.keepNo')}</button>
                </div>
              </>
            ) : (
              <button type="button" className="btn" disabled={locked || dirty} onClick={() => (a.cv.profilEditedByHand ? setAsking(true) : onRefresh(false))}>{t('applications.cv.update')}</button>
            )}
          </div>
        ) : null}
        <fieldset disabled={locked} className="plain">
          <TextField multiline label={t('applications.cv.profil')} value={profil} onChange={setProfil} maxLength={800} hint={t('applications.cv.profilHint')} />
        </fieldset>
        <div className="btn-row">
          <button type="button" className="btn" disabled={locked || saving || !dirty || profil.trim() === ''} onClick={() => void save()}>{t('applications.cv.save')}</button>
          <button type="button" className="btn ghost" disabled={!dirty} onClick={() => setProfil(a.cv.profil)}>{t('applications.letter.discard')}</button>
        </div>
        <p className="muted">{t('applications.cv.fromProfile')} <a href="#/profile">{t('applications.cv.toProfile')}</a></p>
        {error ? <ErrorBanner error={error} /> : null}
      </div>
      <PreviewFrame id={a.id} kind="cv" version={a.updatedAt} title={t('applications.cv.preview')} />
    </div>
  );
}
