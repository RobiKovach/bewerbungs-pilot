import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { ErrorBanner } from '../components/ErrorBanner';
import { LinesField, TextField } from '../profile/fields';
import type { ApplicationView, LetterPatch, PackageLetter } from '../types';
import { PreviewFrame } from './PreviewFrame';

type Draft = Pick<PackageLetter, 'recipient' | 'subject' | 'salutation' | 'paragraphs' | 'closing' | 'signature'>;
const FIELDS = ['recipient', 'subject', 'salutation', 'paragraphs', 'closing', 'signature'] as const;
const MAX_PARAGRAPHS = 6;

function patchOf(saved: PackageLetter, draft: Draft): LetterPatch | null {
  const patch: LetterPatch = {};
  for (const k of FIELDS) if (JSON.stringify(saved[k]) !== JSON.stringify(draft[k])) (patch as Record<string, unknown>)[k] = draft[k];
  return Object.keys(patch).length > 0 ? patch : null;
}

/** `locked`: this package is being changed by a job (editing off). `busy`: any package job runs (Claude buttons off). */
export function LetterTab({ view, locked, busy, onView, onRevise }: { view: ApplicationView; locked: boolean; busy: boolean; onView: (v: ApplicationView) => void; onRevise: (instruction: string) => void }) {
  const { t } = useTranslation();
  const a = view.application;
  const L = a.letter;
  const initial = (): Draft => ({ recipient: L.recipient, subject: L.subject, salutation: L.salutation, paragraphs: L.paragraphs, closing: L.closing, signature: L.signature });
  const [draft, setDraft] = useState<Draft>(initial);
  const [resetKey, setResetKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [instruction, setInstruction] = useState('');
  const patch = patchOf(L, draft);
  const valid = draft.subject.trim() !== '' && draft.paragraphs.length > 0 && draft.paragraphs.every((p) => p.trim() !== '');
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const setParagraph = (i: number, v: string) => set('paragraphs', draft.paragraphs.map((p, j) => (j === i ? v : p)));

  const save = async () => {
    if (!patch) return;
    setSaving(true);
    setError(null);
    try {
      onView(await api.patchLetter(a.id, patch));
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="letter-tab">
      <div className="letter-editor" key={resetKey}>
        {L.hint ? <p className="notice"><strong>{t('applications.letter.hintTitle')}</strong> {L.hint}</p> : null}
        {L.pages > 1 ? <p className="error-text" role="status">{t('applications.letter.tooLong', { pages: L.pages })}</p> : null}
        <fieldset disabled={locked} className="plain">
          <LinesField label={t('applications.letter.recipient')} value={draft.recipient} onChange={(v) => set('recipient', v)} maxLines={6} />
          <TextField label={t('applications.letter.subject')} value={draft.subject} onChange={(v) => set('subject', v)} maxLength={300} />
          <TextField label={t('applications.letter.salutation')} value={draft.salutation} onChange={(v) => set('salutation', v)} maxLength={200} />
          {draft.paragraphs.map((p, i) => (
            <div key={i} className="paragraph-field">
              <TextField multiline label={t('applications.letter.paragraph', { n: i + 1 })} value={p} onChange={(v) => setParagraph(i, v)} maxLength={2000} />
              {draft.paragraphs.length > 1 ? (
                <button type="button" className="btn small ghost" onClick={() => set('paragraphs', draft.paragraphs.filter((_, j) => j !== i))}>{t('applications.letter.removeParagraph')}</button>
              ) : null}
            </div>
          ))}
          {draft.paragraphs.length < MAX_PARAGRAPHS ? (
            <button type="button" className="btn small ghost" onClick={() => set('paragraphs', [...draft.paragraphs, ''])}>{t('applications.letter.addParagraph')}</button>
          ) : null}
          <TextField label={t('applications.letter.closing')} value={draft.closing} onChange={(v) => set('closing', v)} maxLength={100} />
          <TextField label={t('applications.letter.signature')} value={draft.signature} onChange={(v) => set('signature', v)} maxLength={200} />
        </fieldset>
        <div className="btn-row">
          <button type="button" className="btn" disabled={locked || saving || !patch || !valid} onClick={() => void save()}>{t('applications.letter.save')}</button>
          <button type="button" className="btn ghost" disabled={!patch} onClick={() => { setDraft(initial()); setResetKey((k) => k + 1); }}>{t('applications.letter.discard')}</button>
        </div>
        {error ? <ErrorBanner error={error} /> : null}
        <div className="revise">
          <TextField label={t('applications.letter.askLabel')} value={instruction} onChange={setInstruction} maxLength={1000} placeholder={t('applications.letter.askPlaceholder')} />
          <button type="button" className="btn" disabled={busy || !instruction.trim() || patch !== null} onClick={() => { onRevise(instruction.trim()); setInstruction(''); }}>
            {t('applications.letter.ask')}
          </button>
          {patch ? <p className="muted">{t('applications.letter.saveFirst')}</p> : null}
        </div>
      </div>
      <PreviewFrame id={a.id} kind="letter" version={a.updatedAt} title={t('applications.letter.preview')} />
    </div>
  );
}
