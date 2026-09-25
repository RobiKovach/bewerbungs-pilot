import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../api';
import { ErrorBanner } from '../components/ErrorBanner';
import { InfoTip } from '../components/InfoTip';
import type { ProfileDocument, ProfileView } from '../types';
import { MAX_BYTES, MAX_DOCUMENTS } from './constants';
import { TextField } from './fields';
import { useProfile } from './ProfileContext';

function Checkbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return <label className="check"><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /> {label}</label>;
}

function DocumentRow({ doc }: { doc: ProfileDocument }) {
  const { t } = useTranslation();
  const { apply } = useProfile();
  const [label, setLabel] = useState(doc.label);
  const [always, setAlways] = useState(doc.attachAlways);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const dirty = label.trim() !== doc.label || always !== doc.attachAlways;
  const run = async (fn: () => Promise<ProfileView>) => {
    setError(null);
    try { apply(await fn()); } catch (err) { setError(err); }
  };
  return (
    <div className="entry document-row">
      <TextField label={t('profile.files.docName')} value={label} onChange={setLabel} />
      <Checkbox label={t('profile.files.docAlways')} checked={always} onChange={setAlways} />
      <div className="btn-row">
        <a className="btn ghost small" href={api.fileUrl(doc.id)} target="_blank" rel="noopener noreferrer">{t('profile.files.docOpen')}</a>
        {dirty ? <button type="button" className="btn small" disabled={!label.trim()} onClick={() => void run(() => api.saveDocument(doc.id, label.trim(), always))}>{t('profile.files.docSave')}</button> : null}
        <button type="button" className="btn ghost small" onClick={() => (confirmDelete ? void run(() => api.deleteFile(doc.id)) : setConfirmDelete(true))}>
          {confirmDelete ? t('profile.files.docReallyDelete') : t('profile.files.docDelete')}
        </button>
      </div>
      {error ? <ErrorBanner error={error} /> : null}
    </div>
  );
}

export function DocumentsEditor() {
  const { t } = useTranslation();
  const { view, apply } = useProfile();
  const docs = view.profile.documents;
  const inputId = useId();
  const [label, setLabel] = useState('');
  const [always, setAlways] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const add = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (docs.length >= MAX_DOCUMENTS) { setError(new ApiError('TOO_MANY_FILES', `${docs.length} documents`)); return; }
    if (file.size > MAX_BYTES.document) { setError(new ApiError('FILE_TOO_LARGE', `${file.size} bytes`)); return; }
    setBusy(true);
    try {
      apply(await api.uploadDocument(file, label.trim(), always));
      setLabel('');
      setAlways(false);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h2>{t('profile.files.docsTitle')}<InfoTip textKey="info.profileDocs" /></h2>
      <p className="muted">{t('profile.files.docCount', { count: docs.length, max: MAX_DOCUMENTS })}</p>
      {docs.map((d) => <DocumentRow key={JSON.stringify(d)} doc={d} />)}
      <div className="entry">
        <TextField label={t('profile.files.docLabel')} value={label} onChange={setLabel} />
        <Checkbox label={t('profile.files.docAlways')} checked={always} onChange={setAlways} />
        <div className="btn-row"><label className="btn ghost" htmlFor={inputId}>{t('profile.files.docChoose')}</label></div>
        <input id={inputId} type="file" accept=".pdf,application/pdf" className="visually-hidden" disabled={busy}
          onChange={(e) => { void add(e.target.files?.[0]); e.target.value = ''; }} />
      </div>
      {error ? <ErrorBanner error={error} /> : null}
    </div>
  );
}
