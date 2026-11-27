import { AppError } from '../../errors.js';
import { controlIds, escapeXml, renumberIds } from '../controls.js';

/**
 * A form's pages as blocks of top-level body tables (0.15.0): the bbw form has 3 tables per page, separated by a
 * page-break paragraph. `withPages` keeps the first block, repeats the last one as often as needed (fresh control ids)
 * and drops blocks that would stay empty — the document's final section properties stay where they are.
 */
interface Body { head: string; before: string; blocks: string[]; seps: string[]; after: string; tail: string }

function topLevelTables(body: string): [number, number][] {
  const out: [number, number][] = [];
  const re = /<w:tbl>|<\/w:tbl>/g;
  let depth = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    if (m[0] === '<w:tbl>') {
      if (depth === 0) out.push([m.index, -1]);
      depth++;
    } else if (--depth === 0) {
      out[out.length - 1]![1] = m.index + m[0].length;
    }
  }
  return out;
}

export function splitBody(xml: string, tablesPerBlock: number): Body {
  const bodyStart = xml.indexOf('<w:body>') + '<w:body>'.length;
  const bodyEnd = xml.lastIndexOf('</w:body>');
  if (bodyStart < '<w:body>'.length || bodyEnd < 0) throw new AppError('NACHWEIS_FORM_UNKNOWN', 'no document body');
  const body = xml.slice(bodyStart, bodyEnd);
  const tables = topLevelTables(body);
  if (tables.length === 0 || tables.length % tablesPerBlock !== 0) throw new AppError('NACHWEIS_FORM_UNKNOWN', `${tables.length} tables`);
  const blocks: [number, number][] = [];
  for (let i = 0; i < tables.length; i += tablesPerBlock) blocks.push([tables[i]![0], tables[i + tablesPerBlock - 1]![1]]);
  return {
    head: xml.slice(0, bodyStart),
    before: body.slice(0, blocks[0]![0]),
    blocks: blocks.map(([a, b]) => body.slice(a, b)),
    seps: blocks.slice(1).map(([a], i) => body.slice(blocks[i]![1], a)),
    after: body.slice(blocks.at(-1)![1]),
    tail: xml.slice(bodyEnd),
  };
}

/**
 * The page break between blocks: one paragraph squeezed to an exact 1-point line. A form's own separator (empty
 * paragraphs around the break) spills onto an extra empty page when the table above fills its page.
 */
const TINY = '<w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/>';
const TINY_RUN = '<w:rPr><w:sz w:val="2"/><w:szCs w:val="2"/></w:rPr>';
const PAGE_BREAK = `<w:p><w:pPr>${TINY}${TINY_RUN}</w:pPr><w:r>${TINY_RUN}<w:br w:type="page"/></w:r></w:p>`;

/** The document with exactly `pages` page blocks (at least 1). */
export function withPages(xml: string, tablesPerBlock: number, pages: number): string {
  const b = splitBody(xml, tablesPerBlock);
  const want = Math.max(1, pages);
  const template = b.blocks.at(-1)!;
  const used = controlIds(xml);
  const out: string[] = [b.blocks[0]!];
  for (let k = 1; k < want; k++) {
    const original = b.blocks[k];
    out.push(PAGE_BREAK, original ?? renumberIds(template, used));
  }
  return b.head + b.before + out.join('') + squeezeEmptyParagraphs(b.after) + b.tail;
}

/** Child elements of w:pPr that come before w:spacing in the schema: spacing is inserted after them. */
const BEFORE_SPACING = new Set(['pStyle', 'keepNext', 'keepLines', 'pageBreakBefore', 'framePr', 'widowControl', 'numPr', 'suppressLineNumbers', 'pBdr', 'shd', 'tabs', 'suppressAutoHyphens', 'kinsoku', 'wordWrap', 'overflowPunct', 'topLinePunct', 'autoSpaceDE', 'autoSpaceDN', 'bidi', 'adjustRightInd', 'snapToGrid']);
const CHILD = /^<w:(\w+)\b(?:[^>]*\/>|[^>]*>.*?<\/w:\1>)/;

function squeezePPr(pPr: string): string {
  let inner = pPr.slice('<w:pPr>'.length, -'</w:pPr>'.length).replace(/<w:spacing\b[^>]*\/>/, '');
  let at = 0;
  for (let m = CHILD.exec(inner); m && BEFORE_SPACING.has(m[1]!); m = CHILD.exec(inner.slice(at))) at += m[0].length;
  inner = inner.slice(0, at) + TINY + inner.slice(at);
  return `<w:pPr>${inner}</w:pPr>`;
}

/** Empty paragraphs (no text) get an exact 1-point line, so they never push onto a new page. */
export function squeezeEmptyParagraphs(xml: string): string {
  return xml.replace(/<w:p\/>|<w:p(?: [^>]*)?>.*?<\/w:p>/g, (p) => {
    if (p.includes('<w:t') || p.includes('<w:tbl')) return p;
    if (p.endsWith('/>')) return `<w:p><w:pPr>${TINY}</w:pPr></w:p>`;
    const open = /^<w:p(?: [^>]*)?>/.exec(p)![0];
    const rest = p.slice(open.length);
    const pPr = /^<w:pPr>.*?<\/w:pPr>/.exec(rest)?.[0];
    return pPr ? open + squeezePPr(pPr) + rest.slice(pPr.length) : `${open}<w:pPr>${TINY}</w:pPr>${rest}`;
  });
}

/**
 * Plain text next to a label (`Eintritt:` → the following table cell), in every page. The value cell keeps its
 * properties and first paragraph's properties; the text gets the label's font.
 */
export function setLabelValue(xml: string, label: string, value: string): string {
  let out = xml;
  let from = 0;
  const needle = `>${escapeXml(label)}</w:t>`;
  for (;;) {
    const at = out.indexOf(needle, from);
    if (at < 0) return out;
    const labelCellStart = out.lastIndexOf('<w:tc>', at);
    const labelCellEnd = out.indexOf('</w:tc>', at);
    const valueStart = out.indexOf('<w:tc>', labelCellEnd);
    const valueEnd = out.indexOf('</w:tc>', valueStart);
    if (labelCellStart < 0 || labelCellEnd < 0 || valueStart < 0 || valueEnd < 0) return out;
    const rPr = /<w:r>(<w:rPr>.*?<\/w:rPr>)/.exec(out.slice(labelCellStart, labelCellEnd))?.[1] ?? '';
    const cell = out.slice(valueStart, valueEnd);
    const tcHead = /^<w:tc>(?:<w:tcPr>.*?<\/w:tcPr>)?/.exec(cell)![0];
    const pHead = /<w:p(?: [^>]*)?>(?:<w:pPr>.*?<\/w:pPr>)?/.exec(cell.slice(tcHead.length))?.[0] ?? '<w:p>';
    const runs = value ? `<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(value)}</w:t></w:r>` : '';
    const next = `${tcHead}${pHead}${runs}</w:p>`;
    out = out.slice(0, valueStart) + next + out.slice(valueEnd);
    from = valueStart + next.length;
  }
}
