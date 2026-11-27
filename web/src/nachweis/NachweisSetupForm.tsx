import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { ErrorBanner } from '../components/ErrorBanner';
import { LIMITS } from '../profile/constants';
import { TextField } from '../profile/fields';
import { useReportUnsaved } from '../profile/unsaved';
import type { NachweisAudience, NachweisSetup, ProfileView } from '../types';

const AUDIENCES: NachweisAudience[] = ['measure', 'jobcenter', 'agentur'];
const SHORT = 40;

interface Draft {
  audience: NachweisAudience;
  personName: string;
  measure: { provider: string; name: string; entry: string; exit: string; advisor: string };
  office: { name: string; customerNumber: string; advisor: string };
  blank: 'standard' | 'own';
}

function draftOf(initial: NachweisSetup | null, personName: string): Draft {
  return {
    audience: initial?.audience ?? 'measure',
    personName: initial?.personName ?? personName,
    measure: initial?.measure ?? { provider: '', name: '', entry: '', exit: '', advisor: '' },
    office: initial?.office ?? { name: '', customerNumber: '', advisor: '' },
    blank: initial?.blank.kind ?? 'standard',
  };
}

/** What the server stores: only the fields of the chosen audience. */
function bodyOf(d: Draft) {
  const trim = <T extends Record<string, string>>(o: T) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v.trim()])) as T;
  return {
    audience: d.audience,
    personName: d.personName.trim(),
    measure: d.audience === 'measure' ? trim(d.measure) : null,
    office: d.audience === 'measure' ? null : trim(d.office),
  };
}

/**
 * The Bewerbungsnachweis setup (spec 0.15.0, 9.1): who the proof is for, the header data, and which blank form.
 * Entered once; used in the profile section and in the export dialog when nothing is set up yet.
 * `onApply` gets every view the server answered with, also when only part of the save worked (setup saved, own form
 * not recognised); `onSaved` only when everything worked.
 */
export function NachweisSetupForm({ initial, personName, onSaved, onCancel, onApply }: {
  initial: NachweisSetup | null;
  personName: string;
  onSaved: (view: ProfileView) => void;
  onCancel?: () => void;
  onApply?: (view: ProfileView) => void;
}) {
  const { t } = useTranslation();
  const fileId = useId();
  const [draft, setDraft] = useState<Draft>(() => draftOf(initial, personName));
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const start = draftOf(initial, personName);
  const ownOnFile = initial?.blank.kind === 'own' ? initial.blank : null;
  const blankChoice = draft.audience === 'measure' ? draft.blank : 'standard';
  const changed = JSON.stringify(bodyOf(draft)) !== JSON.stringify(bodyOf(start)) || blankChoice !== start.blank || file !== null;
  useReportUnsaved(changed);
  // A first setup may be saved as prefilled (name from the profile, standard form).
  const canSave = initial === null || changed;
  // "My own form" needs a file: the one already saved, or a new one.
  const missingFile = blankChoice === 'own' && !file && !ownOnFile;

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const setMeasure = (key: keyof Draft['measure'], value: string) => setDraft((d) => ({ ...d, measure: { ...d.measure, [key]: value } }));
  const setOffice = (key: keyof Draft['office'], value: string) => setDraft((d) => ({ ...d, office: { ...d.office, [key]: value } }));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      let view = await api.nachweis.saveSetup(bodyOf(draft));
      onApply?.(view);
      if (blankChoice === 'own' && file) {
        try {
          view = await api.nachweis.uploadBlank(file);
        } catch (err) {
          // The setup is saved; the form stays on the standard blank (spec 9.1).
          setFile(null);
          setDraft((d) => ({ ...d, blank: view.profile.nachweis?.blank.kind ?? 'standard' }));
          setError(err);
          return;
        }
      } else if (blankChoice === 'standard' && view.profile.nachweis?.blank.kind === 'own') {
        view = await api.nachweis.removeBlank();
      }
      onApply?.(view);
      onSaved(view);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="nachweis-form">
      <fieldset className="status-options">
        <legend>{t('nachweis.audience.legend')}</legend>
        {AUDIENCES.map((a) => (
          <label key={a}><input type="radio" name={`${fileId}-audience`} checked={draft.audience === a} onChange={() => set('audience', a)} /> {t(`nachweis.audience.${a}`)}</label>
        ))}
      </fieldset>
      <TextField label={t('nachweis.field.personName')} value={draft.personName} maxLength={LIMITS.name} onChange={(v) => set('personName', v)} />
      {draft.audience === 'measure' ? (
        <>
          <TextField label={t('nachweis.field.provider')} value={draft.measure.provider} maxLength={LIMITS.name} onChange={(v) => setMeasure('provider', v)} />
          <TextField label={t('nachweis.field.measureName')} value={draft.measure.name} maxLength={LIMITS.name} onChange={(v) => setMeasure('name', v)} />
          <TextField label={t('nachweis.field.entry')} type="date" value={draft.measure.entry} onChange={(v) => setMeasure('entry', v)} />
          <TextField label={t('nachweis.field.exit')} type="date" value={draft.measure.exit} onChange={(v) => setMeasure('exit', v)} />
          <TextField label={t('nachweis.field.measureAdvisor')} value={draft.measure.advisor} maxLength={LIMITS.name} onChange={(v) => setMeasure('advisor', v)} />
        </>
      ) : (
        <>
          <TextField label={t('nachweis.field.office')} value={draft.office.name} maxLength={LIMITS.name} onChange={(v) => setOffice('name', v)} />
          <TextField label={t('nachweis.field.customerNumber')} value={draft.office.customerNumber} maxLength={SHORT} onChange={(v) => setOffice('customerNumber', v)} />
          <TextField label={t('nachweis.field.officeAdvisor')} value={draft.office.advisor} maxLength={LIMITS.name} onChange={(v) => setOffice('advisor', v)} />
        </>
      )}
      <fieldset className="status-options">
        <legend>{t('nachweis.blank.legend')}</legend>
        <label><input type="radio" name={`${fileId}-blank`} checked={blankChoice === 'standard'} onChange={() => set('blank', 'standard')} /> {t('nachweis.blank.standard')}</label>
        {draft.audience === 'measure'
          ? <label><input type="radio" name={`${fileId}-blank`} checked={blankChoice === 'own'} onChange={() => set('blank', 'own')} /> {t('nachweis.blank.own')}</label>
          : null}
      </fieldset>
      {blankChoice === 'own' ? (
        <div className="field">
          {ownOnFile && !file ? <p className="ok">{t('nachweis.blank.recognised', { name: ownOnFile.file.originalName })}</p> : null}
          <p className="muted">{t('nachweis.blank.ownHint')}</p>
          <div className="btn-row"><label className="btn ghost" htmlFor={fileId}>{t('nachweis.blank.choose')}</label></div>
          <input id={fileId} type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="visually-hidden" disabled={busy}
            onChange={(e) => { setFile(e.target.files?.[0] ?? null); e.target.value = ''; }} />
          {file ? <p className="muted">{t('nachweis.blank.chosen', { name: file.name })}</p> : null}
        </div>
      ) : null}
      {error ? <ErrorBanner error={error} /> : null}
      <div className="btn-row">
        <button type="button" className="btn" disabled={busy || !draft.personName.trim() || missingFile || !canSave} onClick={() => void save()}>{t('nachweis.save')}</button>
        {onCancel ? <button type="button" className="btn ghost" disabled={busy} onClick={onCancel}>{t('common.cancel')}</button> : null}
      </div>
    </div>
  );
}
