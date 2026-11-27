import { describe, expect, it } from 'vitest';
import type { ApplicationPackage, HistoryEntry, Vacancy, VacancyContact } from '@bp/shared';
import { buildRows, exportedAt, isSubmitted, searchedBoxes, toCandidates } from '../src/nachweis/rows.js';
import { pkg } from './helpers/applications.js';
import { vacancy } from './helpers/vacancies.js';

const at = (day: string) => `${day}T12:00:00.000Z`;
const e = (kind: HistoryEntry['kind'], day: string, extra: Partial<HistoryEntry> = {}): HistoryEntry => ({ kind, at: at(day), ...extra });
const contact = (over: Partial<VacancyContact> = {}): VacancyContact => ({ email: '', salutation: '', name: '', phone: '', street: '', postcode: '', city: '', ...over });
const AA = 'https://www.arbeitsagentur.de/jobsuche/jobdetail/10001-1234567890-S';

function sent(day: string, over: Partial<ApplicationPackage> = {}, status: ApplicationPackage['status'] = 'sent'): ApplicationPackage {
  const p = pkg({ status, history: [e('approved', day), e('sent', day, { messageId: '<m@x>' })], ...over });
  if (status !== 'sent' && !over.history) p.history.push(e(status, day));
  return p;
}
const lookup = (vs: Vacancy[]) => (id: string) => vs.find((v) => v.id === id);

describe('rows', () => {
  it("only sent/submitted packages, oldest first; a draft and an approved one are left out; a rejected-after-sent one is in with result 'Absage'", () => {
    const a = sent('2026-11-10');
    const b = pkg({ status: 'submitted', history: [e('approved', '2026-11-03'), e('submitted', '2026-11-03')] });
    const c = sent('2026-11-05', {}, 'rejected');
    const draft = pkg({ status: 'draft' });
    const approved = pkg({ status: 'approved', history: [e('approved', '2026-11-01')] });
    const rows = buildRows([a, b, c, draft, approved], lookup([]));
    expect(rows.map((r) => r.packageId)).toEqual([b.id, c.id, a.id]);
    expect(rows.map((r) => r.appliedAt)).toEqual(['03.11.2026', '05.11.2026', '10.11.2026']);
    expect(rows[1]!.result).toBe('Absage');
    expect(rows[0]!.result).toBe('');
    expect(isSubmitted(draft)).toBe(false);
    expect(isSubmitted(c)).toBe(true);
  });
  it('maps every later status to its German result', () => {
    const r = (s: ApplicationPackage['status']) => buildRows([sent('2026-11-10', {}, s)], lookup([]))[0]!.result;
    expect([r('interview'), r('offer'), r('withdrawn')]).toEqual(['Vorstellungsgespräch', 'Zusage', 'zurückgezogen']);
  });
  it("initiative row: initiative true, foundAt ''", () => {
    const v = vacancy({ id: 'vi', source: 'manual', sourceId: null, addedManually: true, initiative: true, url: '' });
    const p = sent('2026-11-10', { vacancyId: 'vi' });
    p.vacancy.initiative = true;
    const [row] = buildRows([p], lookup([v]));
    expect(row!.initiative).toBe(true);
    expect(row!.foundAt).toBe('');
  });
  it("AA row: position 'Frontend Developer (m/w/d) (Ref.-Nr. 10001-1234567890-S)'; found date from the card", () => {
    const v = vacancy({ id: 'va', sourceId: '10001-1234567890-S', url: AA, foundAt: at('2026-11-02') });
    const p = sent('2026-11-10', { vacancyId: 'va' });
    p.vacancy = { ...p.vacancy, title: 'Frontend Developer (m/w/d)', url: AA };
    const [row] = buildRows([p], lookup([v]));
    expect(row!.position).toBe('Frontend Developer (m/w/d) (Ref.-Nr. 10001-1234567890-S)');
    expect(row!.foundAt).toBe('02.11.2026');
    expect(row!.origin).toBe('arbeitsagentur');
  });
  it("vacancy deleted → Ref.-Nr. from URL, foundAt ''", () => {
    const p = sent('2026-11-10', { vacancyId: 'gone' });
    p.vacancy = { ...p.vacancy, title: 'Dev', url: AA };
    const [row] = buildRows([p], lookup([]));
    expect(row!.position).toBe('Dev (Ref.-Nr. 10001-1234567890-S)');
    expect(row!.foundAt).toBe('');
  });
  it("address only when complete: street missing → companyLines ['Firma GmbH']", () => {
    const p = sent('2026-11-10');
    p.vacancy = { ...p.vacancy, company: 'Firma GmbH', contact: contact({ postcode: '01067', city: 'Dresden' }) };
    expect(buildRows([p], lookup([]))[0]!.companyLines).toEqual(['Firma GmbH']);
    p.vacancy.contact = contact({ street: 'Hauptstr. 1', postcode: '01067', city: 'Dresden' });
    expect(buildRows([p], lookup([]))[0]!.companyLines).toEqual(['Firma GmbH', 'Hauptstr. 1', '01067 Dresden']);
  });
  it("contact: 'Frau Erika Beispiel, Tel. 0351 123'; no phone → e-mail; nothing → ''", () => {
    const p = sent('2026-11-10');
    const c = (cc: VacancyContact | null) => { p.vacancy.contact = cc; return buildRows([p], lookup([]))[0]!.contact; };
    expect(c(contact({ salutation: 'Frau', name: 'Erika Beispiel', phone: '0351 123', email: 'l@firma.de' }))).toBe('Frau Erika Beispiel, Tel. 0351 123');
    expect(c(contact({ name: 'Max Muster', email: 'm@firma.de' }))).toBe('Max Muster, m@firma.de');
    expect(c(contact({ email: 'jobs@firma.de' }))).toBe('jobs@firma.de');
    expect(c(null)).toBe('');
  });
  it('a hidden card whose contact was cleared by the search: the row keeps the contact the package was sent with', () => {
    const p = sent('2026-11-10', { vacancyId: 'vh' });
    p.vacancy.contact = contact({ salutation: 'Frau', name: 'Erika Beispiel', phone: '0351 123', street: 'Hauptstr. 1', postcode: '01067', city: 'Dresden' });
    p.vacancy.contactAuto = ['phone'];
    // VacancyStore.compactHidden(): hidden AA cards lose contact and contactAuto.
    const v = vacancy({ id: 'vh', status: 'hidden', contact: null });
    const row = buildRows([p], lookup([v]))[0]!;
    expect(row.contact).toBe('Frau Erika Beispiel, Tel. 0351 123');
    expect(row.companyLines.slice(1)).toEqual(['Hauptstr. 1', '01067 Dresden']);
    expect(row.contactUnconfirmed).toBe(true);
  });
  it('contactUnconfirmed true when contactAuto includes email and email is shown', () => {
    const v = vacancy({ id: 'vu', contact: contact({ email: 'jobs@firma.de' }), contactAuto: ['email'] });
    const p = sent('2026-11-10', { vacancyId: 'vu' });
    expect(buildRows([p], lookup([v]))[0]!.contactUnconfirmed).toBe(true);
    const v2 = vacancy({ id: 'vu', contact: contact({ email: 'jobs@firma.de', phone: '0351 1' }), contactAuto: ['email'] });
    expect(buildRows([p], lookup([v2]))[0]!.contactUnconfirmed).toBe(false); // the phone is shown, not the auto e-mail
  });
  it('card contact wins over package contact when the vacancy still exists', () => {
    const v = vacancy({ id: 'vc', contact: contact({ name: 'Neu Name' }) });
    const p = sent('2026-11-10', { vacancyId: 'vc' });
    p.vacancy.contact = contact({ name: 'Alt Name' });
    expect(buildRows([p], lookup([v]))[0]!.contact).toBe('Neu Name');
  });
  it('searchedBoxes: one AA + one stepstone link + one company feed row → all three true; pasted text without URL → none', () => {
    const aa = sent('2026-11-10'); aa.vacancy.url = AA;
    const board = sent('2026-11-11', { vacancyId: 'vb' });
    const feed = sent('2026-11-12', { vacancyId: 'vf' });
    const vs = [
      vacancy({ id: 'vb', source: 'manual', sourceId: null, addedManually: true, url: 'https://www.stepstone.de/stellenangebote--x.html' }),
      vacancy({ id: 'vf', source: 'company', sourceId: null, url: 'https://boards.greenhouse.io/firma/jobs/1' }),
    ];
    const rows = buildRows([aa, board, feed], lookup(vs));
    expect(rows.map((r) => r.origin)).toEqual(['arbeitsagentur', 'board', 'company']);
    expect(searchedBoxes(rows)).toEqual({ aa: true, boards: true, companySites: true });
    const text = sent('2026-11-13', { vacancyId: 'vt' });
    const rowsText = buildRows([text], lookup([vacancy({ id: 'vt', source: 'manual', sourceId: null, addedManually: true, url: '' })]));
    expect(rowsText[0]!.origin).toBe('none');
    expect(searchedBoxes(rowsText)).toEqual({ aa: false, boards: false, companySites: false });
  });
  it('two sent packages for the same vacancy → two rows', () => {
    expect(buildRows([sent('2026-11-10', { vacancyId: 'same' }), sent('2026-11-20', { vacancyId: 'same' })], lookup([]))).toHaveLength(2);
  });
});

describe('candidates', () => {
  it('lists submitted packages with the last export date', () => {
    const a = sent('2026-11-10');
    const b = sent('2026-11-12', { history: [e('approved', '2026-11-12'), e('sent', '2026-11-12'), e('nachweis', '2026-11-20', { note: 'a.docx' }), e('nachweis', '2026-11-27', { note: 'b.docx' })] });
    const c = toCandidates([b, a, pkg({ status: 'draft' })], lookup([]));
    expect(c.map((x) => [x.packageId, x.exportedAt])).toEqual([[a.id, null], [b.id, at('2026-11-27')]]);
    expect(exportedAt(b)).toBe(at('2026-11-27'));
    expect(c[0]).toMatchObject({ company: a.vacancy.company, title: a.vacancy.title, appliedAt: at('2026-11-10') });
  });
});
