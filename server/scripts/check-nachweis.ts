// Fills a Bewerbungsnachweis form with made-up rows, for a manual check in Word (spec 0.15.0).
// The output goes to the temp folder (or --out); nothing is written into the repo.
// Usage: npm run check:nachweis -- <own blank.docx> [--rows 14] [--out C:\path\out.docx]
//        npm run check:nachweis -- --standard [--jobcenter] [--rows 11] [--out …]   (the app's own form)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { NachweisSetup } from '@bp/shared';
import { buildNachweis, recognizeForm } from '../src/nachweis/build.js';
import { standardBlankPath } from '../src/nachweis/forms/standard.js';
import type { NachweisRow } from '../src/nachweis/rows.js';

const args = process.argv.slice(2);
const opt = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const standard = args.includes('--standard');
const blank = standard ? standardBlankPath() : args.find((a, i) => !a.startsWith('--') && !['--rows', '--out'].includes(args[i - 1] ?? ''));
if (!blank) {
  console.error('usage: npm run check:nachweis -- <blank.docx> | --standard [--jobcenter] [--rows 14] [--out file.docx]');
  process.exit(2);
}
const count = Number(opt('rows') ?? 14);
const out = opt('out') ?? path.join(os.tmpdir(), `bp-nachweis-check-${Date.now()}.docx`);

const measure: NachweisSetup = {
  audience: 'measure', personName: 'Max Mustermann',
  measure: { provider: 'Beispielträger', name: 'Beispielmaßnahme 2026', entry: '2026-08-17', exit: '', advisor: 'Frau Beispiel' },
  office: null, blank: { kind: 'standard' }, updatedAt: new Date().toISOString(),
};
const setup: NachweisSetup = args.includes('--jobcenter')
  ? { ...measure, audience: 'jobcenter', measure: null, office: { name: 'Jobcenter Beispielstadt', customerNumber: '000A000000', advisor: 'Herr Beispiel' } }
  : measure;
const rows: NachweisRow[] = Array.from({ length: count }, (_, i) => {
  const d = String((i % 28) + 1).padStart(2, '0');
  return {
    packageId: `p${i}`, initiative: i % 5 === 4, foundAt: i % 5 === 4 ? '' : `${d}.10.2026`,
    position: `Beispielstelle ${i + 1} (m/w/d) (Ref.-Nr. 10000-${String(i).padStart(10, '0')}-S)`,
    companyLines: [`Beispiel & Söhne ${i + 1} GmbH`, 'Musterstraße 1', '01067 Dresden'],
    contact: i % 3 === 0 ? '' : 'Frau Erika Muster, Tel. 0351 000000',
    appliedAt: `${d}.11.2026`, appliedIso: `2026-11-${d}T12:00:00.000Z`,
    result: (['', 'Absage', 'Vorstellungsgespräch'] as const)[i % 3]!, origin: i % 4 === 3 ? 'company' : 'arbeitsagentur', contactUnconfirmed: false,
  };
});

const buf = fs.readFileSync(blank);
const form = standard ? 'standard' : await recognizeForm(buf);
if (!form) {
  console.error('not recognised as a known form (bbw QGZ-F-PP018)');
  process.exit(1);
}
fs.writeFileSync(out, await buildNachweis(buf, form, setup, rows));
console.log(`${form}; ${count} rows written to ${out}`);
