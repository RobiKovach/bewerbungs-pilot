import yazl from 'yazl';

/**
 * Synthetic Word blanks for the Bewerbungsnachweis tests (0.15.0). `syntheticBbwBlank` reproduces the STRUCTURE of the
 * bbw form QGZ-F-PP018 as dumped from a real copy (scripts/dump-docx-controls.mjs, journal "Task 2 dump"): run-,
 * paragraph- and cell-level content controls in the same order and cells. All text is made up — the real form and
 * real data never go into the repo.
 */

let nextId = 1000;
const id = () => `<w:id w:val="${nextId++}"/>`;
const R = '<w:rPr><w:rFonts w:asciiTheme="minorBidi"/><w:sz w:val="16"/></w:rPr>';
const run = (t: string) => `<w:r>${R}<w:t xml:space="preserve">${t}</w:t></w:r>`;
const para = (inner = '') => `<w:p><w:pPr>${R}</w:pPr>${inner}</w:p>`;
const cell = (inner: string, w = 1500) => `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/></w:tcPr>${inner}</w:tc>`;

const checkbox = (on = false) =>
  `<w:sdt><w:sdtPr>${R}${id()}<w14:checkbox><w14:checked w14:val="${on ? 1 : 0}"/><w14:checkedState w14:val="2612" w14:font="MS Gothic"/><w14:uncheckedState w14:val="2610" w14:font="MS Gothic"/></w14:checkbox></w:sdtPr><w:sdtContent><w:r>${R}<w:t>${on ? '☒' : '☐'}</w:t></w:r></w:sdtContent></w:sdt>`;
const dateRun = (value = '') =>
  `<w:sdt><w:sdtPr>${R}${id()}${value ? '' : '<w:showingPlcHdr/>'}<w:date w:fullDate="2022-11-18T00:00:00Z"><w:dateFormat w:val="dd.MM.yyyy"/><w:lid w:val="de-DE"/></w:date></w:sdtPr><w:sdtContent>${run(value || '    ')}</w:sdtContent></w:sdt>`;
const datePara = (value = '') =>
  `<w:sdt><w:sdtPr>${R}${id()}${value ? '' : '<w:showingPlcHdr/>'}<w:date w:fullDate="2022-11-18T00:00:00Z"><w:dateFormat w:val="dd.MM.yyyy"/><w:lid w:val="de-DE"/></w:date></w:sdtPr><w:sdtContent>${para(run(value || '    '))}</w:sdtContent></w:sdt>`;
const textRun = (value = '') =>
  `<w:sdt><w:sdtPr>${R}${id()}${value ? '' : '<w:showingPlcHdr/>'}<w:text/></w:sdtPr><w:sdtContent>${run(value || '          ')}</w:sdtContent></w:sdt>`;
const textCell = (value = '', w = 2000) =>
  `<w:sdt><w:sdtPr>${R}${id()}${value ? '' : '<w:showingPlcHdr/>'}<w:text w:multiLine="1"/></w:sdtPr><w:sdtContent>${cell(para(run(value || '        ')), w)}</w:sdtContent></w:sdt>`;

const row = (cells: string) => `<w:tr>${cells}</w:tr>`;
const table = (rows: string) => `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>${rows}</w:tbl>`;

function headerTableA(): string {
  const label = (t: string) => cell(para(run(t)));
  const value = (t: string) => cell(para(t ? run(t) : ''));
  return table(
    row(label('Vorname Name:') + value('Erika Beispiel') + value('') + label('Eintritt:') + value('01.02.2026') + label('Austritt:') + value(''))
    + row(label('Bezeichnung der Maßnahme:') + value('Beispielkurs') + value('') + label('zuständige mitarbeitende Person:') + value('Herr Beispiel')),
  );
}

function headerTableB(): string {
  const c = (inner: string) => cell(para(inner));
  return table(
    row(c(`${checkbox(true)} über das Portal JOBSUCHE der Bundesagentur für Arbeit`) + c(`${checkbox()} durch persönliche / telefonische Anfragen`))
    + row(c(`${checkbox(true)} in anderen Internetjobbörsen: ${textRun('Beispielbörse')}`) + c(''))
    + row(c(`${checkbox()} über persönliche Kontakte`) + c(`${checkbox()} in Tageszeitungen / Zeitungen`))
    + row(c(`${checkbox()} Sonstiges: ${textRun()}`) + c('')),
  );
}

/** One application row: 13 controls in 8 cells, exactly as in the real form. `fake` fills it like a hand-filled form. */
function dataRow(fake: boolean): string {
  const v = (s: string) => (fake ? s : '');
  return row(
    cell(para(`${checkbox(fake)} Datum: ${dateRun(v('03.03.2026'))}`) + para(`${checkbox()} Initiativ-bewerbung`))
    + textCell(v('Beispielstelle (m/w/d)'), 2289)
    + textCell(v('Erfundene Firma GmbH'), 1701)
    + textCell(v('Frau Erfunden'), 1418)
    + cell(datePara(v('04.03.2026')))
    + cell(para(`${checkbox()} schriftlich`) + para(`${checkbox()} telefonisch`) + para(`${checkbox()} persönlich`) + para(`${checkbox(fake)} E-Mail, Internet`))
    + textCell(v('Absage'), 3118)
    + textCell(v('—'), 2694),
  );
}

function rowsTable(filledRows: number): string {
  const head = row(cell(para(run('Stellenangebot oder Initiativbewerbung'))) + cell(para(run('Bewerbungsdatum'))))
    + row(cell(para(run('gefunden am (Datum) oder initiativ'))) + cell(para(run('Tätigkeit als'))));
  let rows = '';
  for (let i = 0; i < 6; i++) rows += dataRow(i < filledRows);
  return table(head + rows);
}

function pageBlock(filledRows: number): string {
  return headerTableA()
    + para() + para(run('Stellenangebote habe ich bisher gesucht:'))
    + headerTableB()
    + para()
    + rowsTable(filledRows);
}

const PAGE_BREAK = para() + para(`<w:r>${R}<w:br w:type="page"/></w:r>`) + para();
const SECT = '<w:sectPr><w:footerReference w:type="default" r:id="rId7"/><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/></w:sectPr>';
const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

export function bbwDocumentXml(opts: { pages?: number; filledRows?: number } = {}): string {
  const pages = opts.pages ?? 2;
  let filled = opts.filledRows ?? 0;
  const blocks: string[] = [];
  for (let p = 0; p < pages; p++) {
    blocks.push(pageBlock(Math.min(6, filled)));
    filled = Math.max(0, filled - 6);
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body><w:p/>${blocks.join(PAGE_BREAK)}${para()}${SECT}</w:body></w:document>`;
}

const CONTENT_TYPES = '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>';
const RELS = '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';

/** Zips parts (name → content) into a .docx buffer. */
export function zipParts(parts: Record<string, string | Buffer>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile();
    for (const [name, content] of Object.entries(parts)) zip.addBuffer(Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8'), name);
    const chunks: Buffer[] = [];
    zip.outputStream.on('data', (c: Buffer) => chunks.push(c)).on('end', () => resolve(Buffer.concat(chunks))).on('error', reject);
    zip.end();
  });
}

export function minimalDocx(bodyXml: string, extra: Record<string, string | Buffer> = {}): Promise<Buffer> {
  return zipParts({
    '[Content_Types].xml': CONTENT_TYPES, '_rels/.rels': RELS,
    'word/document.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${bodyXml}${SECT}</w:body></w:document>`,
    ...extra,
  });
}

export function syntheticBbwBlank(opts: { pages?: number; filledRows?: number } = {}): Promise<Buffer> {
  return zipParts({
    '[Content_Types].xml': CONTENT_TYPES, '_rels/.rels': RELS,
    'word/document.xml': bbwDocumentXml(opts),
    'word/footer1.xml': `<?xml version="1.0" encoding="UTF-8"?><w:ftr ${NS}>${para(run('QGZ-F-PP018-2  /  31.08.2023'))}</w:ftr>`,
    'word/media/image1.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]),
  });
}
