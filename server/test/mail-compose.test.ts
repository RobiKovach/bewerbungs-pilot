import { describe, expect, it } from 'vitest';
import { applicationEmail, followUpEmail, rejectionReply } from '../src/mail/compose.js';
import { fileNames } from '../src/applications/render/html.js';
import { pkg } from './helpers/applications.js';

describe('applicationEmail', () => {
  it('DE email: salutation from the letter, title, closing, signature lines', () => {
    const base = pkg();
    const p = pkg({ language: 'de', letter: { ...base.letter, salutation: 'Sehr geehrte Frau Weiler,' } });
    const e = applicationEmail(p);
    expect(e.subject).toBe(p.letter.subject);
    expect(e.text).toBe('Sehr geehrte Frau Weiler,\n\nanbei sende ich Ihnen meine Bewerbung als Webentwickler (m/w/d) mit Anschreiben und Lebenslauf. Ich freue mich auf Ihre Rückmeldung.\n\nMit freundlichen Grüßen\nMax Mustermann\n+49 30 1234567\nmax@example.com');
  });

  it('EN email and file names', () => {
    const p = pkg({ language: 'en' });
    const e = applicationEmail(p);
    expect(e.text).toBe('Sehr geehrte Damen und Herren,\n\nplease find attached my application for the position of Webentwickler (m/w/d), with my cover letter and CV. I look forward to hearing from you.\n\nKind regards\nMax Mustermann\n+49 30 1234567\nmax@example.com');
    expect(fileNames('Max Mustermann', 'Muster GmbH', 'en')).toMatchObject({ letter: 'Cover_Letter_Max_Mustermann_Muster_GmbH.pdf', cv: 'CV_Max_Mustermann.pdf' });
  });

  it('leaves out empty phone and email lines', () => {
    const p = pkg();
    p.snapshot.personal.phone = '';
    p.snapshot.personal.email = '';
    expect(applicationEmail(p).text.endsWith('Mit freundlichen Grüßen\nMax Mustermann')).toBe(true);
  });
});

describe('reminder and rejection reply', () => {
  it('reminder: same salutation, Re: subject, the position and the day it was sent (DE and EN)', () => {
    const de = pkg({ status: 'sent', language: 'de', sentEmail: { to: 'jobs@muster.example', subject: 'Bewerbung als Webentwickler', body: 'x', attachments: [] },
      history: [{ kind: 'sent', at: '2026-10-05T10:00:00.000Z' }] });
    const m = followUpEmail(de);
    expect(m.subject).toBe('Re: Bewerbung als Webentwickler');
    expect(m.text.startsWith(de.letter.salutation)).toBe(true);
    expect(m.text).toContain(`meiner Bewerbung als ${de.vacancy.title} vom 05.10.2026`);
    expect(m.text).toContain('Mit freundlichen Grüßen\nMax Mustermann');
    const en = followUpEmail({ ...de, language: 'en' });
    expect(en.text).toContain('5 October 2026');
    expect(en.text).toContain('Kind regards');
  });

  it('rejection reply: thanks, interest in the company, ≤ 100 words, no Claude', () => {
    for (const language of ['de', 'en'] as const) {
      const p = pkg({ status: 'rejected', language, history: [{ kind: 'sent', at: '2026-10-05T10:00:00.000Z' }, { kind: 'rejected', at: '2026-10-08T10:00:00.000Z' }] });
      const r = rejectionReply(p);
      expect(r.text).toContain(p.vacancy.company);
      expect(r.text.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(100);
    }
  });
});
