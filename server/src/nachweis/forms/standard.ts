import { fileURLToPath } from 'node:url';
import { findControls, setControls, type ControlValue } from '../controls.js';
import type { DocxParts } from '../docx.js';
import type { NachweisRow } from '../rows.js';
import type { NachweisHeader } from './header.js';
import { withPages } from './pages.js';

/**
 * The app's own neutral form (spec 0.15.0, 8.1), made by scripts/make-nachweis-standard.mjs and shipped in
 * server/assets. Every field is a content control with a `bp.*` tag, so it is filled by tag, not by position.
 */
export const STANDARD_ROWS_PER_PAGE = 10;
const TABLES_PER_PAGE = 2;
const DOC = 'word/document.xml';

/** The same depth from src/nachweis/forms and dist/nachweis/forms. */
export function standardBlankPath(): string {
  return fileURLToPath(new URL('../../../assets/nachweis/standard.docx', import.meta.url));
}

const ORIGIN: Record<NachweisRow['origin'], string> = { arbeitsagentur: 'Arbeitsagentur', board: 'Jobbörse', company: 'Firmenwebseite', none: '' };

function headerLines(h: NachweisHeader): [string, string][] {
  if (h.audience === 'measure') {
    const span = h.entry && h.exit ? `${h.entry} – ${h.exit}` : h.entry ? `ab ${h.entry}` : h.exit ? `bis ${h.exit}` : '';
    return [['Träger:', h.provider], ['Maßnahme:', h.measureName], ['Zeitraum der Maßnahme:', span], ['Ansprechperson:', h.advisor]];
  }
  return [['Stelle:', h.officeName], ['Kunden-/BG-Nummer:', h.customerNumber], ['Ansprechperson (Arbeitsvermittlung):', h.advisor], ['', '']];
}

function rowValue(tag: string, r: NachweisRow | undefined, nr: number): string[] {
  if (!r) return [];
  switch (tag) {
    case 'nr': return [String(nr)];
    case 'date': return [r.appliedAt];
    case 'position': return [r.position];
    case 'company': return r.companyLines;
    case 'contact': return r.contact ? [r.contact] : [];
    case 'kind': return ['E-Mail / Internet'];
    case 'origin': return r.initiative ? ['Initiativ'] : ORIGIN[r.origin] ? [ORIGIN[r.origin]] : [];
    case 'result': return r.result ? [r.result] : [];
    default: return [];
  }
}

export function fillStandard(parts: DocxParts, header: NachweisHeader, rows: NachweisRow[]): DocxParts {
  const pages = Math.max(1, Math.ceil(rows.length / STANDARD_ROWS_PER_PAGE));
  const xml = withPages(parts.xml.get(DOC)!, TABLES_PER_PAGE, pages);
  const lines = headerLines(header);
  const seen = new Map<string, number>(); // tag → how many times met so far (row k, or page k for header tags)
  const edits = new Map<number, ControlValue>();
  findControls(xml).forEach((c, i) => {
    const tag = c.tag ?? '';
    const k = seen.get(tag) ?? 0;
    seen.set(tag, k + 1);
    let value: string[] = [];
    const line = /^bp\.head\.line([1-4])\.(label|value)$/.exec(tag);
    if (tag === 'bp.head.name') value = [header.personName];
    else if (tag === 'bp.head.period') value = header.period ? [header.period] : [];
    else if (line) {
      const v = lines[Number(line[1]) - 1]![line[2] === 'label' ? 0 : 1];
      value = v ? [v] : [];
    } else if (tag.startsWith('bp.row.')) value = rowValue(tag.slice('bp.row.'.length), rows[k], k + 1);
    edits.set(i, { lines: value });
  });
  const xmlParts = new Map(parts.xml);
  xmlParts.set(DOC, setControls(xml, edits));
  return { xml: xmlParts, binary: parts.binary };
}
