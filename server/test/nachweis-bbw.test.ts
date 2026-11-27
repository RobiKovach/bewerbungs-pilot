import { describe, expect, it } from 'vitest';
import type { NachweisSetup } from '@bp/shared';
import { readDocx, writeDocx, type DocxParts } from '../src/nachweis/docx.js';
import { controlIds, findControls } from '../src/nachweis/controls.js';
import { fillBbw, recognizeBbw } from '../src/nachweis/forms/bbw.js';
import { toHeader } from '../src/nachweis/forms/header.js';
import type { NachweisRow } from '../src/nachweis/rows.js';
import { minimalDocx, syntheticBbwBlank } from './helpers/nachweis-blanks.js';

const PAGE = 8 + 6 * 13;
const setup: NachweisSetup = {
  audience: 'measure', personName: 'Robin Testfall',
  measure: { provider: 'Träger', name: 'Kurs Neu 2026', entry: '2026-08-17', exit: '', advisor: 'Frau Beraterin' },
  office: null, blank: { kind: 'standard' }, updatedAt: '2026-11-27T10:00:00.000Z',
};
let n = 0;
function row(over: Partial<NachweisRow> = {}): NachweisRow {
  n++;
  return {
    packageId: `p${n}`, initiative: false, foundAt: '02.11.2026', position: `Stelle ${n} (m/w/d)`, companyLines: [`Firma ${n} & Co. KG`, 'Hauptstr. 1', '01067 Dresden'],
    contact: 'Frau Muster, Tel. 0351 1', appliedAt: '10.11.2026', appliedIso: '2026-11-10T12:00:00.000Z', result: '', origin: 'arbeitsagentur', contactUnconfirmed: false, ...over,
  };
}
const rows = (k: number, over: Partial<NachweisRow> = {}) => Array.from({ length: k }, () => row(over));
const doc = (p: DocxParts) => p.xml.get('word/document.xml')!;
const ctl = (xml: string, i: number) => { const c = findControls(xml)[i]!; return xml.slice(c.start, c.end); };
const checked = (xml: string, i: number) => ctl(xml, i).includes('<w14:checked w14:val="1"/>');
const fill = async (k: number, opts: { filledRows?: number; over?: Partial<NachweisRow> } = {}) => {
  const list = rows(k, opts.over);
  const parts = fillBbw(await readDocx(await syntheticBbwBlank({ filledRows: opts.filledRows ?? 0 })), toHeader(setup, list), list);
  return doc(parts);
};
const pageBreaks = (xml: string) => (xml.match(/<w:br w:type="page"\/>/g) ?? []).length;

describe('bbw form', () => {
  it('recognizes the synthetic blank; refuses minimalDocx; refuses the blank with one row control removed', async () => {
    const parts = await readDocx(await syntheticBbwBlank());
    expect(recognizeBbw(parts)).toBe(true);
    expect(recognizeBbw(await readDocx(await minimalDocx('<w:p/>')))).toBe(false);
    const broken = await readDocx(await syntheticBbwBlank());
    const xml = doc(broken);
    const c = findControls(xml)[20]!;
    broken.xml.set('word/document.xml', xml.slice(0, c.start) + xml.slice(c.end));
    expect(recognizeBbw(broken)).toBe(false);
    const noFooter = await readDocx(await syntheticBbwBlank());
    noFooter.xml.delete('word/footer1.xml');
    expect(recognizeBbw(noFooter)).toBe(false);
  });
  it("already filled blank (filledRows 9) → after fill with 2 rows no old text 'Erika'/fake company remains", async () => {
    const xml = await fill(2, { filledRows: 9 });
    expect(xml).not.toContain('Erika');
    expect(xml).not.toContain('Erfundene Firma');
    expect(xml).not.toContain('Beispielstelle');
    expect(xml).not.toContain('Beispielbörse');
    expect(xml).toContain('Robin Testfall');
    expect(xml).toContain('17.08.2026');
    expect(xml).toContain('Kurs Neu 2026');
    expect(xml).toContain('Frau Beraterin');
  });
  it('4 rows → 1 page (second block removed), rows 5–6 empty, header values replaced, page-break count 0', async () => {
    const xml = await fill(4);
    expect(findControls(xml)).toHaveLength(PAGE);
    expect(pageBreaks(xml)).toBe(0);
    const rowStart = (r: number) => 8 + r * 13;
    expect(ctl(xml, rowStart(3) + 3)).toContain('Stelle');
    expect(ctl(xml, rowStart(4) + 3)).not.toContain('Stelle');
    expect(checked(xml, rowStart(4) + 10)).toBe(false);
    expect(xml.split('Vorname Name:')).toHaveLength(2);
  });
  it('6 rows → 1 page; 7 rows → 2 pages; 13 rows → 3 pages; 0 rows → 1 empty page', async () => {
    expect(findControls(await fill(6))).toHaveLength(PAGE);
    const seven = await fill(7);
    expect(findControls(seven)).toHaveLength(2 * PAGE);
    expect(pageBreaks(seven)).toBe(1);
    const thirteen = await fill(13);
    expect(findControls(thirteen)).toHaveLength(3 * PAGE);
    expect(pageBreaks(thirteen)).toBe(2);
    expect(ctl(thirteen, 2 * PAGE + 8 + 3)).toContain('Stelle'); // the 13th row is on page 3
    const zero = await fill(0);
    expect(findControls(zero)).toHaveLength(PAGE);
    expect(zero).toContain('Robin Testfall');
  });
  it('13 rows → all w:id unique; findControls count = 3 × (8 + 6 × 13)', async () => {
    const xml = await fill(13);
    const ids = [...xml.matchAll(/<w:id w:val="(-?\d+)"\/>/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(controlIds(xml).size).toBe(3 * PAGE);
  });
  it("AA + company rows → on every page box 1 and 6 checked and 'Firmenwebseiten' in Sonstiges; box 3 unchecked", async () => {
    const list = [...rows(6), ...rows(1, { origin: 'company' })];
    const xml = doc(fillBbw(await readDocx(await syntheticBbwBlank({ filledRows: 9 })), toHeader(setup, list), list));
    for (const page of [0, 1]) {
      const b = page * PAGE;
      expect(checked(xml, b + 0)).toBe(true);
      expect(checked(xml, b + 2)).toBe(false);
      expect(checked(xml, b + 6)).toBe(true);
      expect(ctl(xml, b + 7)).toContain('Firmenwebseiten');
      expect(checked(xml, b + 1) || checked(xml, b + 4) || checked(xml, b + 5)).toBe(false);
    }
  });
  it('initiative row → Datum box off, Initiativ box on, found date empty', async () => {
    const xml = await fill(1, { over: { initiative: true, foundAt: '' } });
    expect(checked(xml, 8)).toBe(false);
    expect(checked(xml, 10)).toBe(true);
    expect(ctl(xml, 9)).not.toContain('w:fullDate');
  });
  it('a normal row: Datum box on, found and application dates, only E-Mail/Internet ticked, result written', async () => {
    const xml = await fill(1, { over: { result: 'Absage' } });
    expect(checked(xml, 8)).toBe(true);
    expect(ctl(xml, 9)).toContain('>02.11.2026<');
    expect(ctl(xml, 12)).toContain('&amp; Co. KG');
    expect(ctl(xml, 13)).toContain('Frau Muster, Tel. 0351 1');
    expect(ctl(xml, 14)).toContain('>10.11.2026<');
    expect([15, 16, 17, 18].map((i) => checked(xml, i))).toEqual([false, false, false, true]);
    expect(ctl(xml, 19)).toContain('Absage');
  });
  it('writeDocx(fillBbw(...)) reads back with readDocx (zip valid)', async () => {
    const list = rows(8);
    const parts = fillBbw(await readDocx(await syntheticBbwBlank()), toHeader(setup, list), list);
    const back = await readDocx(await writeDocx(parts));
    expect(recognizeBbw(back)).toBe(true);
    expect(back.binary.get('word/media/image1.png')).toBeDefined();
  });
});

describe('header', () => {
  it('dates become DD.MM.YYYY and the period spans the rows', () => {
    const h = toHeader(setup, [row({ appliedAt: '10.11.2026' }), row({ appliedAt: '17.11.2026' })]);
    expect(h).toMatchObject({ personName: 'Robin Testfall', entry: '17.08.2026', exit: '', measureName: 'Kurs Neu 2026', advisor: 'Frau Beraterin', period: '10.11.2026 – 17.11.2026' });
    expect(toHeader(setup, []).period).toBe('');
    const office = toHeader({ ...setup, audience: 'jobcenter', measure: null, office: { name: 'Jobcenter Dresden', customerNumber: '123A', advisor: 'Herr V' } }, []);
    expect(office).toMatchObject({ officeName: 'Jobcenter Dresden', customerNumber: '123A', advisor: 'Herr V', measureName: '', entry: '' });
  });
});

describe('page layout', () => {
  it('the paragraphs between page blocks and after the last one cannot spill onto an extra empty page', async () => {
    const xml = await fill(13);
    const body = xml.slice(xml.indexOf('<w:body>'), xml.indexOf('</w:body>'));
    // Between blocks: one tiny paragraph that carries the page break — no full-height empty lines around it.
    const between = body.split('</w:tbl>').slice(1).map((s) => s.slice(0, s.indexOf('<w:tbl>') < 0 ? undefined : s.indexOf('<w:tbl>')));
    const seps = between.filter((s) => s.includes('w:type="page"'));
    expect(seps).toHaveLength(2);
    for (const s of seps) {
      expect(s.match(/<w:p[ >]/g)).toHaveLength(1);
      expect(s).toContain('w:lineRule="exact"');
    }
    // After the last table: every empty paragraph is squeezed to an exact tiny line.
    const tail = body.slice(body.lastIndexOf('</w:tbl>'));
    const paras = tail.match(/<w:p>.*?<\/w:p>|<w:p [^>]*>.*?<\/w:p>|<w:p\/>/g) ?? [];
    expect(paras.length).toBeGreaterThan(0);
    for (const p of paras.filter((x) => !x.includes('<w:t'))) expect(p).toContain('w:lineRule="exact"');
  });
});
