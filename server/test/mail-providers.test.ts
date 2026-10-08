import { describe, it, expect } from 'vitest';
import { MAIL_PROVIDERS, providerFor } from '../src/mail/providers.js';

describe('mail providers', () => {
  it('finds the provider by domain, case-insensitive', () => {
    expect(providerFor('Max@GMX.de')?.id).toBe('gmx');
    expect(providerFor('max@googlemail.com')?.id).toBe('gmail');
    expect(providerFor('max@firma.example')).toBeNull();
    expect(providerFor('not-an-address')).toBeNull();
    expect(providerFor('max@outlook.com')).toBeNull(); // personal Outlook needs OAuth2: manual fields
  });
  it('every provider uses an encrypted port', () => {
    for (const p of MAIL_PROVIDERS) expect([465, 587]).toContain(p.port);
    for (const p of MAIL_PROVIDERS) expect(p.security).toBe(p.port === 465 ? 'ssl' : 'starttls');
  });
  it('lists the six known providers with https help links', () => {
    expect(MAIL_PROVIDERS.map((p) => p.id)).toEqual(['gmail', 'gmx', 'webde', 'tonline', 'yahoo', 'icloud']);
    for (const p of MAIL_PROVIDERS) expect(p.helpUrl).toMatch(/^https:\/\//);
  });
});
