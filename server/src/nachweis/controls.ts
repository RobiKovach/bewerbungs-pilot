import { AppError } from '../errors.js';

/**
 * Word content controls (`<w:sdt>`) in a document part (0.15.0). The Bewerbungsnachweis forms are Word forms: every
 * field is a content control — a checkbox, a date or a text, holding a run, a paragraph or a whole table cell.
 * Filling writes into these controls only, so the form's look stays exactly as its author made it.
 */
export type ControlKind = 'checkbox' | 'date' | 'text';
/** Offsets of `<w:sdt>` … `</w:sdt>` in the xml string. */
export interface Control { kind: ControlKind; tag: string | null; start: number; end: number }
export type ControlValue = { checked: boolean } | { date: string } | { lines: string[] };

const OPEN = '<w:sdt>';
const CLOSE = '</w:sdt>';

function kindOf(pr: string): ControlKind | null {
  if (pr.includes('<w14:checkbox')) return 'checkbox';
  if (pr.includes('<w:date')) return 'date';
  if (pr.includes('<w:text')) return 'text';
  return null;
}

/** Every content control in document order. Nested controls are not expected in a form and are refused. */
export function findControls(xml: string): Control[] {
  const out: Control[] = [];
  let at = xml.indexOf(OPEN);
  while (at >= 0) {
    const end = xml.indexOf(CLOSE, at);
    if (end < 0) throw new AppError('NACHWEIS_FORM_UNKNOWN', 'unclosed content control');
    const nextOpen = xml.indexOf(OPEN, at + OPEN.length);
    if (nextOpen >= 0 && nextOpen < end) throw new AppError('NACHWEIS_FORM_UNKNOWN', 'nested content controls');
    const pr = xml.slice(at, xml.indexOf('</w:sdtPr>', at));
    const kind = kindOf(pr);
    if (kind) out.push({ kind, tag: /<w:tag w:val="([^"]*)"\/>/.exec(pr)?.[1] ?? null, start: at, end: end + CLOSE.length });
    at = xml.indexOf(OPEN, end);
  }
  return out;
}

/** XML-escapes text; characters XML 1.0 cannot hold (control characters, lone surrogates) are dropped. */
export function escapeXml(s: string): string {
  const clean = [...s].filter((ch) => {
    const c = ch.codePointAt(0)!;
    return c === 0x9 || c === 0xa || c === 0xd || (c >= 0x20 && c <= 0xd7ff) || (c >= 0xe000 && c <= 0xfffd) || c >= 0x10000;
  }).join('');
  return clean.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** Word's grey "placeholder text" character style (German and English names): an empty field shows it, a value must not. */
const PLACEHOLDER_STYLE = /<w:rStyle w:val="[^"]*(?:Platzhalter|Placeholder)[^"]*"\/>/gi;

/** The run properties of the first run, to keep the form's font and size — without the placeholder look. */
const firstRunProps = (content: string) =>
  (/<w:r>(<w:rPr>.*?<\/w:rPr>)/.exec(content)?.[1] ?? /<w:r [^>]*>(<w:rPr>.*?<\/w:rPr>)/.exec(content)?.[1] ?? '').replace(PLACEHOLDER_STYLE, '');

function runs(rPr: string, lines: string[]): string {
  if (lines.length === 0) return `<w:r>${rPr}<w:t xml:space="preserve"></w:t></w:r>`;
  return `<w:r>${rPr}${lines.map((l) => `<w:t xml:space="preserve">${escapeXml(l)}</w:t>`).join('<w:br/>')}</w:r>`;
}

/** First paragraph opening + its pPr: `<w:p …><w:pPr>…</w:pPr>` (or just the opening tag). */
function paragraphHead(content: string): string {
  const m = /<w:p(?: [^>]*)?>(?:<w:pPr>.*?<\/w:pPr>)?/.exec(content);
  return m ? m[0] : '<w:p>';
}

/** New sdtContent for a value: keeps the cell (`<w:tc>` + tcPr) or paragraph wrapper, replaces the runs. */
function newContent(content: string, lines: string[]): string {
  const rPr = firstRunProps(content);
  const body = runs(rPr, lines);
  if (content.startsWith('<w:tc>') || content.startsWith('<w:tc ')) {
    const tcHead = /^<w:tc(?: [^>]*)?>(?:<w:tcPr>.*?<\/w:tcPr>)?/.exec(content)![0];
    return `${tcHead}${paragraphHead(content.slice(tcHead.length))}${body}</w:p></w:tc>`;
  }
  if (content.startsWith('<w:p>') || content.startsWith('<w:p ')) return `${paragraphHead(content)}${body}</w:p>`;
  return body;
}

function fill(control: string, kind: ControlKind, value: ControlValue): string {
  const prEnd = control.indexOf('</w:sdtPr>');
  let pr = control.slice(0, prEnd).replace('<w:showingPlcHdr/>', '');
  const cStart = control.indexOf('<w:sdtContent>') + '<w:sdtContent>'.length;
  const cEnd = control.lastIndexOf('</w:sdtContent>');
  const between = control.slice(prEnd, cStart); // '</w:sdtPr>' (+ sdtEndPr) + '<w:sdtContent>'
  const content = control.slice(cStart, cEnd);
  let next: string;
  if (kind === 'checkbox' && 'checked' in value) {
    pr = pr.replace(/<w14:checked w14:val="[^"]*"\/>/, `<w14:checked w14:val="${value.checked ? 1 : 0}"/>`);
    next = content.replace(/[☐☒]/g, value.checked ? '☒' : '☐');
  } else if (kind === 'date' && 'date' in value) {
    const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value.date);
    pr = m
      ? pr.replace(/<w:date(?: w:fullDate="[^"]*")?/, `<w:date w:fullDate="${m[3]}-${m[2]}-${m[1]}T00:00:00Z"`)
      : pr.replace(/ w:fullDate="[^"]*"/, '');
    next = newContent(content, value.date ? [value.date] : []);
  } else if (kind === 'text' && 'lines' in value) {
    next = newContent(content, value.lines);
  } else {
    throw new Error(`value ${JSON.stringify(value)} does not fit a ${kind} control`);
  }
  return `${pr}${between}${next}${control.slice(cEnd)}`;
}

/** Writes values into controls (keys = index into findControls(xml)); applied from the last to the first, so offsets hold. */
export function setControls(xml: string, edits: Map<number, ControlValue>): string {
  const controls = findControls(xml);
  let out = xml;
  for (const i of [...edits.keys()].sort((a, b) => b - a)) {
    const c = controls[i];
    if (!c) throw new Error(`no control ${i}`);
    out = out.slice(0, c.start) + fill(out.slice(c.start, c.end), c.kind, edits.get(i)!) + out.slice(c.end);
  }
  return out;
}

const ID = /<w:id w:val="(-?\d+)"\/>/g;

/** The ids of all controls in a part. */
export function controlIds(xml: string): Set<number> {
  return new Set([...xml.matchAll(ID)].map((m) => Number(m[1])));
}

/** A cloned block gets a fresh unique id for every control (Word wants them unique); `used` is updated. */
export function renumberIds(xml: string, used: Set<number>): string {
  let next = 1;
  return xml.replace(ID, () => {
    while (used.has(next)) next++;
    used.add(next);
    return `<w:id w:val="${next}"/>`;
  });
}
