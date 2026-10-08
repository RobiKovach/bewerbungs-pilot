import { describe, expect, it } from 'vitest';
import { applicationEmail } from '../src/mail/compose.js';
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
