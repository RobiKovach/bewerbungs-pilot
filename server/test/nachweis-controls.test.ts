import { describe, expect, it } from 'vitest';
import { AppError } from '../src/errors.js';
import { readDocx, writeDocx } from '../src/nachweis/docx.js';
import { controlIds, escapeXml, findControls, renumberIds, setControls, type ControlValue } from '../src/nachweis/controls.js';
import { bbwDocumentXml, minimalDocx, syntheticBbwBlank, zipParts } from './helpers/nachweis-blanks.js';

const ROW = ['checkbox', 'date', 'checkbox', 'text', 'text', 'text', 'date', 'checkbox', 'checkbox', 'checkbox', 'checkbox', 'text', 'text'];
const HEAD = ['checkbox', 'checkbox', 'checkbox', 'text', 'checkbox', 'checkbox', 'checkbox', 'text'];
const PAGE = [...HEAD, ...Array.from({ length: 6 }, () => ROW).flat()];
const one = (i: number, v: ControlValue) => new Map([[i, v]]);
const inner = (xml: string, i: number) => { const c = findControls(xml)[i]!; return xml.slice(c.start, c.end); };

describe('docx parts', () => {
  it('readDocx/writeDocx round trip keeps every part byte-equal for binary and string-equal for xml', async () => {
    const parts = await readDocx(await syntheticBbwBlank());
    const again = await readDocx(await writeDocx(parts));
    expect([...again.xml.keys()].sort()).toEqual([...parts.xml.keys()].sort());
    for (const [k, v] of parts.xml) expect(again.xml.get(k)).toBe(v);
    expect(again.binary.get('word/media/image1.png')!.equals(parts.binary.get('word/media/image1.png')!)).toBe(true);
  });
  it('writes [Content_Types].xml first', async () => {
    const buf = await writeDocx(await readDocx(await syntheticBbwBlank()));
    // The first local file header's name starts at offset 30.
    expect(buf.subarray(30, 30 + '[Content_Types].xml'.length).toString()).toBe('[Content_Types].xml');
  });
  it("readDocx refuses a zip with '../x' or more than 200 entries", async () => {
    // yazl refuses to write '../', so write a same-length safe name and patch it in both headers.
    const evil = Buffer.from((await zipParts({ 'word/document.xml': '<a/>', 'zz/x.xml': '<a/>' })).toString('latin1').split('zz/x.xml').join('../x.xml'), 'latin1');
    await expect(readDocx(evil)).rejects.toMatchObject({ code: 'NACHWEIS_FORM_UNKNOWN' });
    const many: Record<string, string> = {};
    for (let i = 0; i < 201; i++) many[`word/p${i}.xml`] = '<a/>';
    await expect(readDocx(await zipParts(many))).rejects.toBeInstanceOf(AppError);
    await expect(readDocx(Buffer.from('not a zip'))).rejects.toMatchObject({ code: 'NACHWEIS_FORM_UNKNOWN' });
  });
});

describe('content controls', () => {
  it('findControls on synthetic bbw blank returns 172 controls, kinds match the dump', () => {
    const kinds = findControls(bbwDocumentXml()).map((c) => c.kind);
    expect(kinds).toEqual([...PAGE, ...PAGE]);
  });
  it('setControls checkbox on → w14:checked 1 and ☒; off → 0 and ☐', () => {
    const xml = bbwDocumentXml();
    const on = setControls(xml, one(1, { checked: true }));
    expect(inner(on, 1)).toContain('<w14:checked w14:val="1"/>');
    expect(inner(on, 1)).toContain('☒');
    const off = setControls(on, one(1, { checked: false }));
    expect(inner(off, 1)).toContain('<w14:checked w14:val="0"/>');
    expect(inner(off, 1)).toContain('☐');
    expect(inner(off, 1)).not.toContain('☒');
  });
  it("setControls date '10.11.2026' → text and w:fullDate 2026-11-10T00:00:00Z; '' → empty, no fullDate", () => {
    const xml = bbwDocumentXml();
    const d = setControls(xml, one(9, { date: '10.11.2026' }));
    expect(inner(d, 9)).toContain('w:fullDate="2026-11-10T00:00:00Z"');
    expect(inner(d, 9)).toContain('>10.11.2026</w:t>');
    expect(inner(d, 9)).not.toContain('showingPlcHdr');
    const e = setControls(d, one(9, { date: '' }));
    expect(inner(e, 9)).not.toContain('w:fullDate');
    expect(inner(e, 9)).not.toContain('10.11.2026');
  });
  it("setControls text with ['A & B <GmbH>', 'Straße 1', '01067 Dresden'] → escaped, two <w:br/>, formatting of first run kept", () => {
    const xml = bbwDocumentXml();
    const i = 12; // Firma of the first row (cell-level control)
    const out = setControls(xml, one(i, { lines: ['A & B <GmbH>', 'Straße 1', '01067 Dresden'] }));
    const c = inner(out, i);
    expect(c).toContain('A &amp; B &lt;GmbH&gt;');
    expect(c.match(/<w:br\/>/g)).toHaveLength(2);
    expect(c).toContain('<w:sz w:val="16"/>');
    expect(c).toMatch(/<w:sdtContent><w:tc><w:tcPr>.*<\/w:tc><\/w:sdtContent>/);
    expect(c).not.toContain('showingPlcHdr');
    expect(findControls(out)).toHaveLength(172);
  });
  it('setControls on a paragraph-level date keeps one paragraph', () => {
    const out = setControls(bbwDocumentXml(), one(14, { date: '04.03.2026' }));
    expect(inner(out, 14).match(/<w:p>/g)).toHaveLength(1);
  });
  it('applies many edits at once without shifting', () => {
    const xml = bbwDocumentXml();
    const edits = new Map<number, ControlValue>([[11, { lines: ['Stelle'] }], [12, { lines: ['Firma'] }], [13, { lines: [] }], [18, { checked: true }]]);
    const out = setControls(xml, edits);
    expect(inner(out, 11)).toContain('>Stelle<');
    expect(inner(out, 12)).toContain('>Firma<');
    expect(inner(out, 18)).toContain('☒');
  });
  it('escapeXml drops characters XML 1.0 cannot hold and escapes the rest', () => {
    expect(escapeXml('a\u0001b"c\'<&>😀')).toBe('ab&quot;c&apos;&lt;&amp;&gt;😀');
  });
  it('renumberIds gives every control of a cloned block a fresh unique id', () => {
    const xml = bbwDocumentXml({ pages: 1 });
    const used = controlIds(xml);
    const clone = renumberIds(xml, used);
    const all = [...controlIds(xml), ...controlIds(clone)];
    expect(new Set(all).size).toBe(all.length);
  });
  it('refuses nested controls', async () => {
    const nested = '<w:sdt><w:sdtPr><w:text/></w:sdtPr><w:sdtContent><w:sdt><w:sdtPr><w:text/></w:sdtPr><w:sdtContent><w:r><w:t>x</w:t></w:r></w:sdtContent></w:sdt></w:sdtContent></w:sdt>';
    const parts = await readDocx(await minimalDocx(`<w:p>${nested}</w:p>`));
    expect(() => findControls(parts.xml.get('word/document.xml')!)).toThrow(AppError);
  });
});
