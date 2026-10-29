import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../api';
import { ErrorBanner } from '../components/ErrorBanner';
import { SelectField, TextField } from '../profile/fields';
import { useReportUnsaved } from '../profile/unsaved';
import type { ContactProposal, ContactSource, Salutation, VacancyContact } from '../types';
import { useScrollIntoView } from './dialog';

const SALUTATIONS: readonly Salutation[] = ['', 'Frau', 'Herr'];
/** The server's limits for a contact (VACANCY_LIMITS) and for a pasted text. */
const MAX = { email: 300, name: 200, phone: 40, street: 120, postcode: 10, city: 80 } as const;
const PASTE_MAX = 20_000;
type Field = keyof typeof MAX;
const FIELDS: readonly Field[] = ['name', 'email', 'phone', 'street', 'postcode', 'city'];

const EMPTY: VacancyContact = { email: '', salutation: '', name: '', phone: '', street: '', postcode: '', city: '' };
const same = (a: VacancyContact, b: VacancyContact) => (Object.keys(EMPTY) as Array<keyof VacancyContact>).every((k) => a[k] === b[k]);

/** What the search is doing / how it ended — calm texts, the fields stay editable for a manual entry. */
type Phase =
  | { kind: 'idle' } | { kind: 'searching'; from: ContactSource | 'paste' }
  | { kind: 'found' } | { kind: 'none' } | { kind: 'cancelled' } | { kind: 'timeout' } | { kind: 'noBrowser' } | { kind: 'unreadable' };

/**
 * "Find contact" (0.9.1 B6): open the Arbeitsagentur offer in a visible Edge window (the person solves the captcha),
 * read the partner's page, or parse a pasted text. A result only fills the fields; nothing is stored until "Save",
 * which the caller does (the package editor through its package, a vacancy card through the vacancy).
 * One search at a time: while it runs every action waits; "Cancel" aborts the request (the server closes the window).
 */
export function ContactDialog({ vacancyId, canAa, partnerUrl, initial, save, onClose }: {
  vacancyId: string;
  /** An Arbeitsagentur offer: the AA page can be opened. */
  canAa: boolean;
  /** The partner's page about the offer; '' = none. */
  partnerUrl: string;
  initial: VacancyContact | null;
  /** Stores the contact (null = no contact); the dialog shows the error if it fails. */
  save: (contact: VacancyContact | null) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const ref = useScrollIntoView<HTMLDivElement>();
  const start = initial ?? EMPTY;
  const [contact, setContact] = useState<VacancyContact>(start);
  const [paste, setPaste] = useState('');
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const abort = useRef<AbortController | null>(null);
  // Closing the dialog (or leaving the page) stops a running search: the server closes the window.
  useEffect(() => () => abort.current?.abort(), []);
  useReportUnsaved(!same(contact, start));

  const searching = phase.kind === 'searching';
  const busy = searching || saving;
  const set = (k: keyof VacancyContact, v: string) => setContact((c) => ({ ...c, [k]: v }));

  const take = (r: ContactProposal) => {
    if (r.found.length === 0) { setPhase({ kind: 'none' }); return; }
    // Only what was found replaces a field; what the person already had stays for the rest.
    setContact((c) => ({ ...c, ...Object.fromEntries(r.found.map((k) => [k, r.proposal[k]])) }));
    setPhase({ kind: 'found' });
  };
  const run = async (from: ContactSource | 'paste') => {
    const ctl = new AbortController();
    abort.current = ctl;
    setError(null);
    setPhase({ kind: 'searching', from });
    try {
      if (from === 'paste') {
        take(await api.parseContact(vacancyId, paste, ctl.signal));
      } else {
        const r = await api.findContact(vacancyId, from, ctl.signal);
        if ('cancelled' in r) setPhase({ kind: 'cancelled' });
        else take(r);
      }
    } catch (err) {
      if (ctl.signal.aborted || (err as Error).name === 'AbortError') { setPhase({ kind: 'cancelled' }); return; }
      if (err instanceof ApiError && err.reason === 'contactTimeout') setPhase({ kind: 'timeout' });
      else if (err instanceof ApiError && err.code === 'BROWSER_MISSING') setPhase({ kind: 'noBrowser' });
      else if (err instanceof ApiError && err.reason === 'pageUnreadable') setPhase({ kind: 'unreadable' });
      else { setPhase({ kind: 'idle' }); setError(err); }
    } finally {
      if (abort.current === ctl) abort.current = null;
    }
  };
  const stop = () => abort.current?.abort();

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const c: VacancyContact = { ...contact, ...Object.fromEntries(FIELDS.map((k) => [k, contact[k].trim()])) };
      const filled = FIELDS.some((k) => c[k] !== '');
      // A salutation belongs to a name: without one it would only produce "Sehr geehrte Frau ,".
      await save(filled ? { ...c, salutation: c.name ? c.salutation : '' } : null);
    } catch (err) {
      setError(err);
      setSaving(false);
    }
  };

  const waitingKey = phase.kind === 'searching'
    ? phase.from === 'aa' ? 'contact.waitingAa' : phase.from === 'partner' ? 'contact.waitingPartner' : 'contact.waitingPaste'
    : null;
  const notice = phase.kind === 'found' || phase.kind === 'none' || phase.kind === 'cancelled' || phase.kind === 'timeout'
    || phase.kind === 'noBrowser' || phase.kind === 'unreadable' ? `contact.result.${phase.kind}` : null;
  return (
    <div ref={ref} className="card notice contact-dialog" role="dialog" aria-label={t('contact.title')}>
      <h2>{t('contact.title')}</h2>
      <div className="contact-dialog__sources">
        {canAa ? (
          <div>
            <button type="button" className="btn" disabled={busy} onClick={() => void run('aa')}>{t('contact.openAa')}</button>
            <p className="muted">{t('contact.openAaHint')}</p>
          </div>
        ) : null}
        {partnerUrl ? (
          <div><button type="button" className="btn ghost" disabled={busy} onClick={() => void run('partner')}>{t('contact.readPartner')}</button></div>
        ) : null}
        <fieldset disabled={busy} className="plain">
          <TextField multiline rows={4} label={t('contact.paste')} value={paste} onChange={setPaste} maxLength={PASTE_MAX} />
        </fieldset>
        <div className="btn-row">
          <button type="button" className="btn ghost" disabled={busy || paste.trim() === ''} onClick={() => void run('paste')}>{t('contact.parse')}</button>
        </div>
      </div>

      {waitingKey ? (
        <div className="notice" role="status">
          <p>{t(waitingKey)}</p>
          <div className="btn-row"><button type="button" className="btn ghost" onClick={stop}>{t('common.cancel')}</button></div>
        </div>
      ) : null}
      {notice ? <p className={phase.kind === 'found' ? 'notice notice-ok' : 'notice'} role="status">{t(notice)}</p> : null}

      <fieldset disabled={busy} className="plain form-grid">
        <SelectField label={t('contact.fields.salutation')} value={contact.salutation} options={SALUTATIONS} optionLabel={(s) => s || '—'} onChange={(v) => set('salutation', v)} />
        {FIELDS.map((k) => (
          <TextField key={k} type={k === 'email' ? 'email' : 'text'} label={t(`contact.fields.${k}`)} value={contact[k]} onChange={(v) => set(k, v)} maxLength={MAX[k]} />
        ))}
      </fieldset>
      {error ? <ErrorBanner error={error} /> : null}
      {/* While a search runs its own "Cancel" (above) is the only way out: one button, one meaning. */}
      {searching ? null : (
        <div className="btn-row">
          <button type="button" className="btn" disabled={saving} onClick={() => void submit()}>{t('contact.save')}</button>
          <button type="button" className="btn ghost" disabled={saving} onClick={onClose}>{t('common.cancel')}</button>
        </div>
      )}
    </div>
  );
}
