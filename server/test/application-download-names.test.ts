import { describe, it, expect } from 'vitest';
import { toView } from '../src/applications/views.js';
import { pkg, readyPackageProfile } from './helpers/applications.js';

// 0.13.1: the browser's "Save as" window opens before the file is made, so it cannot read the name from the answer —
// the view carries the same names the server puts into Content-Disposition.
describe('download names in the package view', () => {
  it('German package: Anschreiben/Lebenslauf/Bewerbung with name and company, attachments by label', () => {
    const profile = readyPackageProfile((p) => {
      p.documents = [
        { id: '11111111-1111-4111-8111-111111111111', label: 'Zeugnis Müller', originalName: 'scan.pdf', size: 10, storedName: 'a.pdf', addedAt: '2026-11-01T00:00:00.000Z' },
        { id: '22222222-2222-4222-8222-222222222222', label: '', originalName: 'Führerschein.pdf', size: 10, storedName: 'b.pdf', addedAt: '2026-11-01T00:00:00.000Z' },
      ] as never;
    });
    const p = pkg({ attachments: ['11111111-1111-4111-8111-111111111111'] }, profile);
    const v = toView(p, profile, new Date('2026-11-23T10:00:00.000Z'), null, undefined);
    expect(v.downloadNames).toEqual({
      letter: 'Anschreiben_Max_Mustermann_Muster_GmbH.pdf',
      cv: 'Lebenslauf_Max_Mustermann.pdf',
      bundle: 'Bewerbung_Max_Mustermann_Muster_GmbH.pdf',
      attachments: {
        '11111111-1111-4111-8111-111111111111': 'Zeugnis_Mueller.pdf',
        '22222222-2222-4222-8222-222222222222': 'Fuehrerschein.pdf',
      },
    });
  });

  it('English package uses the English names', () => {
    const profile = readyPackageProfile();
    const v = toView(pkg({ language: 'en' }, profile), profile, new Date('2026-11-23T10:00:00.000Z'), null, undefined);
    expect(v.downloadNames.letter).toBe('Cover_Letter_Max_Mustermann_Muster_GmbH.pdf');
    expect(v.downloadNames.cv).toBe('CV_Max_Mustermann.pdf');
    expect(v.downloadNames.bundle).toBe('Application_Max_Mustermann_Muster_GmbH.pdf');
  });
});
