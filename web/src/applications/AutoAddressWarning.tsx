import { useTranslation } from 'react-i18next';

/** The recipient e-mail the app found by itself and the person has not confirmed yet (0.13.0, spec section 7). */
export interface AutoRecipient { email: string; domain: string }

/** From the package view: null when the recipient was entered or confirmed by the person. */
export function autoRecipientOf(recipientAuto: { domain: string } | null, contactEmail: string | undefined): AutoRecipient | null {
  return recipientAuto && contactEmail ? { email: contactEmail, domain: recipientAuto.domain } : null;
}

/**
 * "The address was found automatically on <domain> — check that it belongs to the company": a hint only, Send stays on.
 * Shown while the window's "To" is that found address; another address typed by the person needs no warning.
 */
export function AutoAddressWarning({ auto, to }: { auto: AutoRecipient | null | undefined; to: string }) {
  const { t } = useTranslation();
  if (!auto || to.trim().toLowerCase() !== auto.email.trim().toLowerCase()) return null;
  return (
    <div className="card notice notice-warn auto-address" role="status">
      <p>{t('applications.autoAddress', { domain: auto.domain })}</p>
    </div>
  );
}
