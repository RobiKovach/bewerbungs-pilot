import type { MailProvider } from '@bp/shared';

export type { MailProvider };

// Hosts and ports from each provider's own documentation (see the task report for sources).
// Only encrypted ports: 465 = SSL, 587 = STARTTLS.
export const MAIL_PROVIDERS: readonly MailProvider[] = [
  { id: 'gmail', label: 'Gmail', domains: ['gmail.com', 'googlemail.com'], host: 'smtp.gmail.com', port: 465, security: 'ssl', helpUrl: 'https://myaccount.google.com/apppasswords' },
  { id: 'gmx', label: 'GMX', domains: ['gmx.de', 'gmx.net', 'gmx.at', 'gmx.ch'], host: 'mail.gmx.net', port: 587, security: 'starttls', helpUrl: 'https://hilfe.gmx.net/' },
  { id: 'webde', label: 'WEB.DE', domains: ['web.de'], host: 'smtp.web.de', port: 587, security: 'starttls', helpUrl: 'https://hilfe.web.de/' },
  { id: 'tonline', label: 'T-Online', domains: ['t-online.de'], host: 'securesmtp.t-online.de', port: 465, security: 'ssl', helpUrl: 'https://www.telekom.de/hilfe/apps-dienste/e-mail' },
  { id: 'yahoo', label: 'Yahoo', domains: ['yahoo.com', 'yahoo.de'], host: 'smtp.mail.yahoo.com', port: 465, security: 'ssl', helpUrl: 'https://help.yahoo.com/kb/SLN15241.html' },
  { id: 'icloud', label: 'iCloud', domains: ['icloud.com', 'me.com'], host: 'smtp.mail.me.com', port: 587, security: 'starttls', helpUrl: 'https://support.apple.com/102654' },
];

export function providerFor(address: string): MailProvider | null {
  const at = address.lastIndexOf('@');
  if (at < 0) return null;
  const domain = address.slice(at + 1).trim().toLowerCase();
  return MAIL_PROVIDERS.find((p) => p.domains.includes(domain)) ?? null;
}
