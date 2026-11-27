import { findControls, setControls, type ControlKind, type ControlValue } from '../controls.js';
import type { DocxParts } from '../docx.js';
import { searchedBoxes, type NachweisRow } from '../rows.js';
import type { NachweisHeader } from './header.js';
import { setLabelValue, splitBody, withPages } from './pages.js';

/**
 * The bbw "Aktivitätennachweis" QGZ-F-PP018 (spec 0.15.0, 8.2) — a blank the person brings; the form itself is never
 * part of the app. Structure (checked on a real copy, journal "Task 2 dump"): per page 3 tables — the name/measure
 * labels as plain cells, 8 header controls ("where I searched"), then 6 rows of 13 controls.
 */
export const BBW_ROWS_PER_PAGE = 6;
const TABLES_PER_PAGE = 3;
const HEAD: ControlKind[] = ['checkbox', 'checkbox', 'checkbox', 'text', 'checkbox', 'checkbox', 'checkbox', 'text'];
const ROW: ControlKind[] = ['checkbox', 'date', 'checkbox', 'text', 'text', 'text', 'date', 'checkbox', 'checkbox', 'checkbox', 'checkbox', 'text', 'text'];
const PAGE: ControlKind[] = [...HEAD, ...Array.from({ length: BBW_ROWS_PER_PAGE }, () => ROW).flat()];
const LABELS = { name: 'Vorname Name:', entry: 'Eintritt:', exit: 'Austritt:', measure: 'Bezeichnung der Maßnahme:', advisor: 'zuständige mitarbeitende Person:' } as const;

// Header controls of a page: [JOBSUCHE, persönlich/telefonisch], [andere Internetjobbörsen, its text],
// [persönliche Kontakte, Zeitungen], [Sonstiges, its text].
// The boards' names (control 3) are not known per row: that field is cleared like every other.
const H = { aa: 0, boards: 2, other: 6, otherText: 7 } as const;
// Row controls: Datum box, found date, Initiativ box, Tätigkeit, Firma, Ansprechperson, Bewerbungsdatum,
// schriftlich, telefonisch, persönlich, E-Mail/Internet, Ergebnis, Gründe.
const C = { foundBox: 0, found: 1, initiative: 2, position: 3, company: 4, contact: 5, applied: 6, online: 10, result: 11, reasons: 12 } as const;

const DOC = 'word/document.xml';

export function recognizeBbw(parts: DocxParts): boolean {
  const footer = [...parts.xml].some(([name, xml]) => /^word\/footer\d*\.xml$/.test(name) && xml.includes('QGZ-F-PP018'));
  const xml = parts.xml.get(DOC);
  if (!footer || !xml) return false;
  try {
    const kinds = findControls(xml).map((c) => c.kind);
    const pages = kinds.length / PAGE.length;
    if (!Number.isInteger(pages) || pages < 1) return false;
    if (kinds.some((k, i) => k !== PAGE[i % PAGE.length])) return false;
    if (splitBody(xml, TABLES_PER_PAGE).blocks.length !== pages) return false;
  } catch {
    return false;
  }
  return Object.values(LABELS).every((l) => xml.includes(`>${l}</w:t>`));
}

function rowValues(r: NachweisRow | undefined): ControlValue[] {
  const v: ControlValue[] = [
    { checked: false }, { date: '' }, { checked: false }, { lines: [] }, { lines: [] }, { lines: [] }, { date: '' },
    { checked: false }, { checked: false }, { checked: false }, { checked: false }, { lines: [] }, { lines: [] },
  ];
  if (!r) return v;
  v[C.foundBox] = { checked: !r.initiative };
  v[C.found] = { date: r.initiative ? '' : r.foundAt };
  v[C.initiative] = { checked: r.initiative };
  v[C.position] = { lines: [r.position] };
  v[C.company] = { lines: r.companyLines };
  v[C.contact] = { lines: r.contact ? [r.contact] : [] };
  v[C.applied] = { date: r.appliedAt };
  v[C.online] = { checked: true };
  v[C.result] = { lines: r.result ? [r.result] : [] };
  return v;
}

/** Fills the bbw form: old entries cleared, the header from the setup, as many pages as the rows need. */
export function fillBbw(parts: DocxParts, header: NachweisHeader, rows: NachweisRow[]): DocxParts {
  const pages = Math.max(1, Math.ceil(rows.length / BBW_ROWS_PER_PAGE));
  let xml = withPages(parts.xml.get(DOC)!, TABLES_PER_PAGE, pages);
  const boxes = searchedBoxes(rows);
  const edits = new Map<number, ControlValue>();
  for (let p = 0; p < pages; p++) {
    const base = p * PAGE.length;
    const head: ControlValue[] = [{ checked: false }, { checked: false }, { checked: false }, { lines: [] }, { checked: false }, { checked: false }, { checked: false }, { lines: [] }];
    head[H.aa] = { checked: boxes.aa };
    head[H.boards] = { checked: boxes.boards };
    head[H.other] = { checked: boxes.companySites };
    head[H.otherText] = { lines: boxes.companySites ? ['Firmenwebseiten'] : [] };
    head.forEach((v, i) => edits.set(base + i, v));
    for (let r = 0; r < BBW_ROWS_PER_PAGE; r++) {
      rowValues(rows[p * BBW_ROWS_PER_PAGE + r]).forEach((v, i) => edits.set(base + HEAD.length + r * ROW.length + i, v));
    }
  }
  xml = setControls(xml, edits);
  xml = setLabelValue(xml, LABELS.name, header.personName);
  xml = setLabelValue(xml, LABELS.entry, header.entry);
  xml = setLabelValue(xml, LABELS.exit, header.exit);
  xml = setLabelValue(xml, LABELS.measure, header.measureName);
  xml = setLabelValue(xml, LABELS.advisor, header.advisor);
  const xmlParts = new Map(parts.xml);
  xmlParts.set(DOC, xml);
  return { xml: xmlParts, binary: parts.binary };
}
