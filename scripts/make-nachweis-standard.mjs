// Writes the app's own standard Bewerbungsnachweis form: server/assets/nachweis/standard.docx (spec 0.15.0, 8.1).
// The output is committed; run this again only after changing the layout here. Every field is a Word content control
// with a w:tag (bp.head.* / bp.row.*), so the app fills it by tag. A4 landscape; one page block = header table + rows table (10 rows).
// Usage: node scripts/make-nachweis-standard.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const yazl = createRequire(path.join(root, 'server', 'package.json'))('yazl');
const ROWS = 10;

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="w14"';
const rPr = (size = 18, bold = false) => `<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>${bold ? '<w:b/>' : ''}<w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr>`;
const run = (t, size, bold) => `<w:r>${rPr(size, bold)}<w:t xml:space="preserve">${t}</w:t></w:r>`;
const p = (inner = '', after = 0) => `<w:p><w:pPr><w:spacing w:before="0" w:after="${after}"/></w:pPr>${inner}</w:p>`;
const border = '<w:tcBorders><w:top w:val="single" w:sz="4" w:color="808080"/><w:left w:val="single" w:sz="4" w:color="808080"/><w:bottom w:val="single" w:sz="4" w:color="808080"/><w:right w:val="single" w:sz="4" w:color="808080"/></w:tcBorders>';
const underline = '<w:tcBorders><w:bottom w:val="single" w:sz="4" w:color="808080"/></w:tcBorders>';
const tc = (inner, w, opts = {}) => `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${opts.span ? `<w:gridSpan w:val="${opts.span}"/>` : ''}${opts.noBorder ? '' : opts.underline ? underline : border}${opts.shade ? '<w:shd w:val="clear" w:color="auto" w:fill="E8E8E8"/>' : ''}</w:tcPr>${inner}</w:tc>`;
let id = 1;
/** A cell-level text control: the whole cell is the field. */
const field = (tag, w, size = 18, opts = {}) =>
  `<w:sdt><w:sdtPr>${rPr(size)}<w:alias w:val="${tag}"/><w:tag w:val="${tag}"/><w:id w:val="${id++}"/><w:text w:multiLine="1"/></w:sdtPr><w:sdtContent>${tc(p(run('', size)), w, opts)}</w:sdtContent></w:sdt>`;
const tr = (cells, opts = {}) => `<w:tr><w:trPr>${opts.header ? '<w:tblHeader/>' : ''}${opts.height ? `<w:trHeight w:val="${opts.height}"/>` : ''}<w:cantSplit/></w:trPr>${cells}</w:tr>`;
const tbl = (grid, rows) => `<w:tbl><w:tblPr><w:tblW w:w="${grid.reduce((a, b) => a + b, 0)}" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="70" w:type="dxa"/><w:right w:w="70" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${grid.map((g) => `<w:gridCol w:w="${g}"/>`).join('')}</w:tblGrid>${rows}</w:tbl>`;

// Header: title, name + period, then 4 label/value lines (both are fields: the labels depend on the audience).
const HEAD_GRID = [2600, 4700, 2600, 4670];
function headerTable() {
  const label = (tag, w) => field(tag, w, 18, { noBorder: true });
  const value = (tag, w) => field(tag, w, 18, { underline: true });
  const line = (i, wl, wv) => label(`bp.head.line${i}.label`, wl) + value(`bp.head.line${i}.value`, wv);
  return tbl(HEAD_GRID,
    tr(tc(p(run('Nachweis über Bewerbungsbemühungen', 28, true), 60), 14570, { span: 4, noBorder: true }))
    + tr(tc(p(run('Name:', 18, true)), 2600, { noBorder: true }) + value('bp.head.name', 4700) + tc(p(run('Zeitraum:', 18, true)), 2600, { noBorder: true }) + value('bp.head.period', 4670))
    + tr(line(1, 2600, 4700) + line(2, 2600, 4670))
    + tr(line(3, 2600, 4700) + line(4, 2600, 4670)),
  );
}

const COLS = [
  ['Nr.', 'nr', 600], ['Bewerbungs-\ndatum', 'date', 1300], ['Stelle (Ref.-Nr.)', 'position', 2800], ['Firma und Anschrift', 'company', 3100],
  ['Ansprechperson', 'contact', 2200], ['Art', 'kind', 1200], ['Quelle', 'origin', 1470], ['Ergebnis', 'result', 1900],
];
function rowsTable() {
  const head = tr(COLS.map(([t, , w]) => tc(t.split('\n').map((l) => p(run(l, 16, true))).join(''), w, { shade: true })).join(''), { header: true });
  let rows = '';
  for (let i = 0; i < ROWS; i++) rows += tr(COLS.map(([, tag, w]) => field(`bp.row.${tag}`, w, 16)).join(''), { height: 620 });
  return tbl(COLS.map((c) => c[2]), head + rows);
}

const block = () => headerTable() + p('', 120) + rowsTable();
const SECT = '<w:sectPr><w:footerReference w:type="default" r:id="rIdFooter"/><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/><w:pgMar w:top="850" w:right="1134" w:bottom="850" w:left="1134" w:header="425" w:footer="425" w:gutter="0"/></w:sectPr>';
// Spacing BEFORE the signature line, not an empty paragraph: empty ones after the last table are squeezed when filled.
const signature = `<w:p><w:pPr><w:spacing w:before="360" w:after="0"/></w:pPr>${run('Datum, Unterschrift: ____________________________________', 18)}</w:p>`;
const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${block()}${signature}${SECT}</w:body></w:document>`;

const fld = (instr) => `<w:r>${rPr(16)}<w:fldChar w:fldCharType="begin"/></w:r><w:r>${rPr(16)}<w:instrText xml:space="preserve"> ${instr} </w:instrText></w:r><w:r>${rPr(16)}<w:fldChar w:fldCharType="separate"/></w:r><w:r>${rPr(16)}<w:t>1</w:t></w:r><w:r>${rPr(16)}<w:fldChar w:fldCharType="end"/></w:r>`;
const footer = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr ${NS}><w:p><w:pPr><w:jc w:val="right"/></w:pPr>${run('Erstellt mit BewerbungsPilot · Seite ', 16)}${fld('PAGE')}${run(' von ', 16)}${fld('NUMPAGES')}</w:p></w:ftr>`;
const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${NS}><w:docDefaults><w:rPrDefault>${rPr(18)}</w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`;
const settings = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings ${NS}><w:defaultTabStop w:val="708"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`;
const contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>';
const rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>';
const docRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdSettings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/><Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>';
const core = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Nachweis über Bewerbungsbemühungen</dc:title><dc:creator>BewerbungsPilot</dc:creator></cp:coreProperties>';

const parts = {
  '[Content_Types].xml': contentTypes, '_rels/.rels': rels, 'docProps/core.xml': core,
  'word/document.xml': document, 'word/styles.xml': styles, 'word/settings.xml': settings, 'word/footer1.xml': footer, 'word/_rels/document.xml.rels': docRels,
};
const out = path.join(root, 'server', 'assets', 'nachweis', 'standard.docx');
fs.mkdirSync(path.dirname(out), { recursive: true });
const zip = new yazl.ZipFile();
// Fixed dates keep the file byte-identical between runs.
for (const [name, content] of Object.entries(parts)) zip.addBuffer(Buffer.from(content, 'utf8'), name, { mtime: new Date('2026-11-27T00:00:00Z') });
const chunks = [];
zip.outputStream.on('data', (c) => chunks.push(c)).on('end', () => { fs.writeFileSync(out, Buffer.concat(chunks)); console.log(`written ${path.relative(root, out)}`); });
zip.end();
