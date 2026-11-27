import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { NachweisSetup } from '@bp/shared';
import { AppError } from '../src/errors.js';
import { readDocx } from '../src/nachweis/docx.js';
import { findControls } from '../src/nachweis/controls.js';
import { fillStandard, standardBlankPath, STANDARD_ROWS_PER_PAGE } from '../src/nachweis/forms/standard.js';
import { toHeader } from '../src/nachweis/forms/header.js';
import { buildNachweis, recognizeForm } from '../src/nachweis/build.js';
import type { NachweisRow } from '../src/nachweis/rows.js';
import { minimalDocx, syntheticBbwBlank } from './helpers/nachweis-blanks.js';

const measure: NachweisSetup = {
  audience: 'measure', personName: 'Robin Testfall',
  measure: { provider: 'Träger Beispiel e. V.', name: 'Kurs Neu 2026', entry: '2026-08-17', exit: '2027-02-16', advisor: 'Frau Beraterin' },
  office: null, blank: { kind: 'standard' }, updatedAt: '2026-11-27T10:00:00.000Z',
};
const jobcenter: NachweisSetup = { ...measure, audience: 'jobcenter', measure: null, office: { name: 'Jobcenter Dresden', customerNumber: '123A456', advisor: 'Herr Vermittler' } };
let n = 0;
const row = (over: Partial<NachweisRow> = {}): NachweisRow => {
  n++;
  return {
    packageId: `p${n}`, initiative: false, foundAt: '02.11.2026', position: `Stelle ${n}`, companyLines: [`Firma ${n}`, '01067 Dresden'], contact: 'Frau Muster',
    appliedAt: '10.11.2026', appliedIso: '2026-11-10T12:00:00.000Z', result: '', origin: 'arbeitsagentur', contactUnconfirmed: false, ...over,
  };
};
const rows = (k: number) => Array.from({ length: k }, () => row());
const blank = () => readDocx(fs.readFileSync(standardBlankPath()));
const fill = async (setup: NachweisSetup, list: NachweisRow[]) => fillStandard(await blank(), toHeader(setup, list), list).xml.get('word/document.xml')!;
const tagged = (xml: string, tag: string) => findControls(xml).filter((c) => c.tag === tag).map((c) => xml.slice(c.start, c.end));
const text = (ctl: string) => [...ctl.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('');

describe('standard form', () => {
  it('standard.docx in assets is recognised as standard (recognizeForm → null) and has 10 rows per block, every control tagged', async () => {
    const buf = fs.readFileSync(standardBlankPath());
    expect(await recognizeForm(buf)).toBeNull();
    const xml = (await readDocx(buf)).xml.get('word/document.xml')!;
    const controls = findControls(xml);
    expect(controls.every((c) => c.tag?.startsWith('bp.'))).toBe(true);
    expect(tagged(xml, 'bp.row.nr')).toHaveLength(STANDARD_ROWS_PER_PAGE);
    expect(STANDARD_ROWS_PER_PAGE).toBe(10);
    expect(xml).toContain('Nachweis über Bewerbungsbemühungen');
  });
  it("fill 1 row → 1 page, row nr '1', other rows empty", async () => {
    const xml = await fill(measure, [row({ position: 'Webentwickler (m/w/d)' })]);
    const nr = tagged(xml, 'bp.row.nr');
    expect(nr).toHaveLength(10);
    expect(text(nr[0]!)).toBe('1');
    expect(nr.slice(1).map(text)).toEqual(Array(9).fill(''));
    expect(text(tagged(xml, 'bp.row.position')[0]!)).toBe('Webentwickler (m/w/d)');
    expect(text(tagged(xml, 'bp.row.kind')[0]!)).toBe('E-Mail / Internet');
    expect(text(tagged(xml, 'bp.row.origin')[0]!)).toBe('Arbeitsagentur');
    expect(text(tagged(xml, 'bp.row.kind')[1]!)).toBe('');
  });
  it('11 rows → 2 pages, nr 1–11; 0 rows → 1 page', async () => {
    const xml = await fill(measure, rows(11));
    const nr = tagged(xml, 'bp.row.nr').map(text);
    expect(nr).toHaveLength(20);
    expect(nr.slice(0, 11)).toEqual(Array.from({ length: 11 }, (_, i) => String(i + 1)));
    expect(tagged(xml, 'bp.head.name').map(text)).toEqual(['Robin Testfall', 'Robin Testfall']);
    const ids = [...xml.matchAll(/<w:id w:val="(-?\d+)"\/>/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(tagged(await fill(measure, []), 'bp.row.nr')).toHaveLength(10);
  });
  it('origin per row: board → Jobbörse, company → Firmenwebseite, initiative → Initiativ, none → empty', async () => {
    const xml = await fill(measure, [row({ origin: 'board' }), row({ origin: 'company' }), row({ initiative: true, origin: 'company' }), row({ origin: 'none' })]);
    expect(tagged(xml, 'bp.row.origin').slice(0, 4).map(text)).toEqual(['Jobbörse', 'Firmenwebseite', 'Initiativ', '']);
  });
  it('measure header shows Träger/Maßnahme lines; jobcenter header shows Kunden-/BG-Nummer', async () => {
    const m = await fill(measure, [row({ appliedAt: '10.11.2026' }), row({ appliedAt: '20.11.2026' })]);
    const labels = (xml: string) => [1, 2, 3, 4].map((i) => text(tagged(xml, `bp.head.line${i}.label`)[0]!));
    const values = (xml: string) => [1, 2, 3, 4].map((i) => text(tagged(xml, `bp.head.line${i}.value`)[0]!));
    expect(labels(m)).toEqual(['Träger:', 'Maßnahme:', 'Zeitraum der Maßnahme:', 'Ansprechperson:']);
    expect(values(m)).toEqual(['Träger Beispiel e. V.', 'Kurs Neu 2026', '17.08.2026 – 16.02.2027', 'Frau Beraterin']);
    expect(text(tagged(m, 'bp.head.period')[0]!)).toBe('10.11.2026 – 20.11.2026');
    const j = await fill(jobcenter, []);
    expect(labels(j)).toEqual(['Stelle:', 'Kunden-/BG-Nummer:', 'Ansprechperson (Arbeitsvermittlung):', '']);
    expect(values(j)).toEqual(['Jobcenter Dresden', '123A456', 'Herr Vermittler', '']);
  });
  it('a measure without an exit date shows "ab <entry>"', async () => {
    const xml = await fill({ ...measure, measure: { ...measure.measure!, exit: '' } }, []);
    expect(text(tagged(xml, 'bp.head.line3.value')[0]!)).toBe('ab 17.08.2026');
  });
});

describe('build', () => {
  it("buildNachweis with form 'bbw-qgz-pp018' on the synthetic blank → recognizeForm(result) === 'bbw-qgz-pp018'", async () => {
    const out = await buildNachweis(await syntheticBbwBlank({ filledRows: 3 }), 'bbw-qgz-pp018', measure, rows(8));
    expect(await recognizeForm(out)).toBe('bbw-qgz-pp018');
  });
  it('buildNachweis with own form but blank not recognised → AppError NACHWEIS_FORM_CHANGED', async () => {
    await expect(buildNachweis(await minimalDocx('<w:p/>'), 'bbw-qgz-pp018', measure, rows(1))).rejects.toMatchObject({ code: 'NACHWEIS_FORM_CHANGED' });
    await expect(buildNachweis(Buffer.from('nope'), 'bbw-qgz-pp018', measure, rows(1))).rejects.toBeInstanceOf(AppError);
  });
  it('buildNachweis standard → a docx with the rows', async () => {
    const out = await buildNachweis(fs.readFileSync(standardBlankPath()), 'standard', jobcenter, rows(3));
    const xml = (await readDocx(out)).xml.get('word/document.xml')!;
    expect(tagged(xml, 'bp.row.nr').map(text).slice(0, 4)).toEqual(['1', '2', '3', '']);
  });
  it('recognizeForm on garbage → null', async () => {
    expect(await recognizeForm(Buffer.from('not a zip'))).toBeNull();
  });
});

describe('release', () => {
  it('release.mjs packs server/assets/nachweis/standard.docx', async () => {
    const mod = (await import(pathToFileURL(fileURLToPath(new URL('../../scripts/release-files.mjs', import.meta.url))).href)) as { RELEASE_FILES: string[] };
    expect(mod.RELEASE_FILES).toContain('server/assets');
    expect(fs.readFileSync(fileURLToPath(new URL('../../scripts/release.mjs', import.meta.url)), 'utf8')).toContain('RELEASE_FILES');
  });
});
