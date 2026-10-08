import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { ErrorBanner } from '../components/ErrorBanner';
import type { Language, MailProvider, MailSecurity, MailSettingsView } from '../types';

interface Props { initial: MailSettingsView; onSaved: (v: MailSettingsView) => void; onCancel?: () => void }

const domainOf = (address: string): string => {
  const at = address.lastIndexOf('@');
  return at < 0 ? '' : address.slice(at + 1).trim().toLowerCase();
};

export function MailWizard({ initial, onSaved, onCancel }: Props) {
  const { t, i18n } = useTranslation();
  const saved = initial.mail;
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [providers, setProviders] = useState<MailProvider[] | null>(null);
  const [address, setAddress] = useState(saved?.address ?? '');
  const [senderName, setSenderName] = useState(saved?.senderName ?? '');
  const [host, setHost] = useState(saved?.host ?? '');
  const [port, setPort] = useState(saved ? String(saved.port) : '465');
  const [security, setSecurity] = useState<MailSecurity>(saved?.security ?? 'ssl');
  const [user, setUser] = useState(saved?.user ?? '');
  const [userTouched, setUserTouched] = useState(Boolean(saved && saved.user !== saved.address));
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let alive = true;
    api.mailProviders().then((p) => { if (alive) setProviders(p); }, () => { if (alive) setProviders([]); });
    return () => { alive = false; };
  }, []);

  // The sender name starts as the profile's full name (only when nothing was saved before).
  useEffect(() => {
    if (saved?.senderName) return;
    let alive = true;
    api.getProfile().then(
      (v) => { if (alive) setSenderName((cur) => cur || v.profile.sections.personal.data.fullName); },
      () => {},
    );
    return () => { alive = false; };
  }, [saved?.senderName]);

  const domain = domainOf(address);
  const provider = domain ? providers?.find((p) => p.domains.includes(domain)) ?? null : null;
  const effectiveUser = provider || !userTouched ? address.trim() : user.trim();
  const portNumber = Number(port);
  const addressOk = /^[^@\s]+@[^@\s]+$/.test(address.trim());
  const serverOk = provider !== null || (host.trim() !== '' && Number.isInteger(portNumber) && portNumber > 0 && effectiveUser !== '');
  const step1Ok = providers !== null && addressOk && senderName.trim() !== '' && serverOk;
  const step2Ok = password !== '' || initial.passwordSaved;

  const changeSecurity = (s: MailSecurity) => {
    setSecurity(s);
    if (port === '465' || port === '587') setPort(s === 'ssl' ? '465' : '587');
  };

  const send = async () => {
    setRunning(true);
    setError(null);
    setDone(false);
    try {
      const view = await api.saveMail({
        address: address.trim(),
        senderName: senderName.trim(),
        host: provider ? provider.host : host.trim(),
        port: provider ? provider.port : portNumber,
        security: provider ? provider.security : security,
        user: effectiveUser,
        ...(password ? { password } : {}),
        language: i18n.language as Language,
      });
      setDone(true);
      onSaved(view);
    } catch (err) {
      setError(err);
    } finally {
      setRunning(false);
    }
  };

  const helpSteps = t(provider ? `mail.help.${provider.id}` : 'mail.help.custom').split('\n');

  return (
    <div className="mail-wizard">
      <p className="muted">{t('common.stepOf', { current: step, total: 3 })}</p>

      {step === 1 ? (
        <>
          <h3>{t('mail.step1Title')}</h3>
          <div className="form-grid">
            <label className="field">
              <span className="field-head">{t('mail.address')}</span>
              <input type="email" value={address} autoComplete="email" onChange={(e) => setAddress(e.target.value)} />
              {provider ? <span className="field-hint ok">{t('mail.detected', { provider: provider.label })}</span> : null}
            </label>
            <label className="field">
              <span className="field-head">{t('mail.senderName')}</span>
              <input type="text" value={senderName} onChange={(e) => setSenderName(e.target.value)} />
              <span className="field-hint">{t('mail.senderNameHint')}</span>
            </label>
          </div>
          {addressOk && providers !== null && !provider ? (
            <>
              <h4>{t('mail.otherEmail')}</h4>
              <div className="form-grid">
                <label className="field">
                  <span className="field-head">{t('mail.host')}</span>
                  <input type="text" value={host} onChange={(e) => setHost(e.target.value)} />
                </label>
                <label className="field">
                  <span className="field-head">{t('mail.port')}</span>
                  <input type="number" value={port} onChange={(e) => setPort(e.target.value)} />
                </label>
                <fieldset className="checkbox-group">
                  <legend>{t('mail.security')}</legend>
                  <label className="checkbox-field">
                    <input type="radio" name="mail-security" checked={security === 'ssl'} onChange={() => changeSecurity('ssl')} />
                    <span>{t('mail.securitySsl')}</span>
                  </label>
                  <label className="checkbox-field">
                    <input type="radio" name="mail-security" checked={security === 'starttls'} onChange={() => changeSecurity('starttls')} />
                    <span>{t('mail.securityStarttls')}</span>
                  </label>
                </fieldset>
                <label className="field">
                  <span className="field-head">{t('mail.user')}</span>
                  <input type="text" value={userTouched ? user : address.trim()} onChange={(e) => { setUserTouched(true); setUser(e.target.value); }} />
                </label>
              </div>
            </>
          ) : null}
          <div className="btn-row">
            {onCancel ? <button type="button" className="btn ghost" onClick={onCancel}>{t('common.cancel')}</button> : null}
            <button type="button" className="btn" disabled={!step1Ok} onClick={() => setStep(2)}>{t('common.next')}</button>
          </div>
        </>
      ) : null}

      {step === 2 ? (
        <>
          <h3>{t('mail.step2Title')}</h3>
          <p>{t('mail.appPasswordWhy')}</p>
          <ol className="mail-help">
            {helpSteps.map((s) => <li key={s}>{s}</li>)}
          </ol>
          {provider ? (
            <p><a href={provider.helpUrl} target="_blank" rel="noreferrer">{t('mail.openSettings', { provider: provider.label })}</a></p>
          ) : null}
          <label className="field">
            <span className="field-head">{t('mail.password')}</span>
            <span className="mail-password">
              <input
                type={showPassword ? 'text' : 'password'} value={password} autoComplete="off"
                placeholder={initial.passwordSaved ? t('mail.passwordSaved') : ''}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button type="button" className="btn ghost" onClick={() => setShowPassword((v) => !v)}>
                {showPassword ? t('mail.hide') : t('mail.show')}
              </button>
            </span>
          </label>
          <div className="btn-row">
            <button type="button" className="btn ghost" onClick={() => setStep(1)}>{t('common.back')}</button>
            <button type="button" className="btn" disabled={!step2Ok} onClick={() => setStep(3)}>{t('common.next')}</button>
          </div>
        </>
      ) : null}

      {step === 3 ? (
        <>
          <h3>{t('mail.step3Title')}</h3>
          <p>{t('mail.checkBody', { address: address.trim() })}</p>
          {running ? <p className="muted" role="status">{t('mail.testing')}</p> : null}
          {done ? <p className="ok" role="status">{t('mail.done')}</p> : null}
          {error ? <ErrorBanner error={error} /> : null}
          <div className="btn-row">
            <button type="button" className="btn ghost" disabled={running} onClick={() => { setDone(false); setStep(2); }}>{t('common.back')}</button>
            <button type="button" className="btn" disabled={running} onClick={() => void send()}>{t('mail.test')}</button>
          </div>
        </>
      ) : null}
    </div>
  );
}
