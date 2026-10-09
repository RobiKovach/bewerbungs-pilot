import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { ErrorBanner } from '../components/ErrorBanner';
import type { MailSettingsView } from '../types';
import { MailWizard } from './MailWizard';

export function MailSettingsBlock() {
  const { t } = useTranslation();
  const [view, setView] = useState<MailSettingsView | null>(null);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let alive = true;
    api.getMail().then((v) => { if (alive) setView(v); }, (err: unknown) => { if (alive) setError(err); });
    api.mailProviders().then(
      (list) => { if (alive) setLabels(Object.fromEntries(list.map((p) => [p.id, p.label]))); },
      () => {},
    );
    return () => { alive = false; };
  }, []);

  const disconnect = async () => {
    setConfirming(false);
    setError(null);
    try {
      setView(await api.disconnectMail());
      setJustSaved(false);
    } catch (err) {
      setError(err);
    }
  };

  if (!view) return error ? <ErrorBanner error={error} /> : <p className="muted">{t('common.loading')}</p>;

  if (editing) {
    return (
      <MailWizard
        initial={view}
        onCancel={() => setEditing(false)}
        onSaved={(v) => { setView(v); setEditing(false); setJustSaved(true); }}
      />
    );
  }

  const mail = view.mail;
  return (
    <>
      {justSaved ? <p className="ok" role="status">{t('mail.done')}</p> : null}
      {mail ? (
        <>
          {view.passwordSaved
            ? <p>{t(mail.kind === 'google' ? 'mail.google.connectedWith' : 'mail.connectedAs', { address: mail.address })}</p>
            : <p className="notice" role="status">{t(mail.kind === 'google' ? 'mail.google.again' : 'mail.passwordAgain')}</p>}
          {mail.kind === 'smtp'
            ? <p className="muted">{t('mail.providerLine', { provider: labels[mail.provider] ?? t('mail.otherEmail') })}</p>
            : null}
          <div className="btn-row">
            <button type="button" className="btn" onClick={() => { setJustSaved(false); setEditing(true); }}>{t('mail.change')}</button>
            <button type="button" className="btn ghost" onClick={() => setConfirming(true)}>{t('mail.disconnect')}</button>
          </div>
          {confirming ? (
            <div className="card notice" role="alertdialog" aria-label={t('mail.disconnect')}>
              <p>{t(mail.kind === 'google' ? 'mail.google.disconnectConfirm' : 'mail.disconnectConfirm')}</p>
              <div className="btn-row">
                <button type="button" className="btn" onClick={() => void disconnect()}>{t('mail.disconnectYes')}</button>
                <button type="button" className="btn ghost" onClick={() => setConfirming(false)}>{t('common.cancel')}</button>
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <>
          <p>{t('mail.notConnected')}</p>
          <div className="btn-row">
            <button type="button" className="btn" onClick={() => { setJustSaved(false); setEditing(true); }}>{t('mail.connect')}</button>
          </div>
        </>
      )}
      {error ? <ErrorBanner error={error} /> : null}
    </>
  );
}
