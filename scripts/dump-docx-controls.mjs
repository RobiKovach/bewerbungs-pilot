// Prints the structure of the Word content controls in a .docx (kinds, rows, cells, page blocks) — never its text, so
// the output can be pasted into notes without personal data. Used to check a real blank form (spec 0.15.0, 8.2).
// Usage: node scripts/dump-docx-controls.mjs <file.docx>
import fs from 'node:fs';
import yauzl from 'yauzl';

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/dump-docx-controls.mjs <file.docx>');
  process.exit(2);
}

function readEntries(buf) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buf, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(err);
      const out = new Map();
      zip.on('entry', (e) => {
        if (/\/$/.test(e.fileName)) return zip.readEntry();
        zip.openReadStream(e, (err2, s) => {
          if (err2) return reject(err2);
          const chunks = [];
          s.on('data', (c) => chunks.push(c));
          s.on('end', () => { out.set(e.fileName, Buffer.concat(chunks)); zip.readEntry(); });
        });
      });
      zip.on('end', () => resolve(out));
      zip.on('error', reject);
      zip.readEntry();
    });
  });
}

const kindOf = (pr) => (pr.includes('w14:checkbox') ? 'checkbox' : pr.includes('<w:date') ? 'date' : pr.includes('<w:text') ? 'text' : 'other');

const entries = await readEntries(fs.readFileSync(file));
const doc = entries.get('word/document.xml').toString('utf8');
console.log('parts:', [...entries.keys()].filter((n) => /^word\/(header|footer)\d*\.xml$/.test(n)).join(', '));
for (const [name, buf] of entries) {
  if (/^word\/(header|footer)\d*\.xml$/.test(name)) console.log(`${name}: has QGZ code = ${buf.toString('utf8').includes('QGZ-F-PP018')}`);
}
console.log('page breaks (w:br page):', (doc.match(/<w:br w:type="page"\/>/g) || []).length, '· sectPr:', (doc.match(/<w:sectPr/g) || []).length);

// Walk the body tables: one line per table row that holds controls, listing per cell the control kinds.
const tables = doc.split('<w:tbl>').slice(1).map((t) => t.split('</w:tbl>')[0]);
let total = 0;
tables.forEach((t, ti) => {
  const rows = t.split(/<w:tr[ >]/).slice(1);
  rows.forEach((r, ri) => {
    const cells = r.split('<w:tc>').slice(1);
    const perCell = cells.map((c) => c.split('<w:sdt>').slice(1).map((s) => kindOf(s.split('</w:sdtPr>')[0])).join('+') || '·');
    const n = (r.match(/<w:sdt>/g) || []).length;
    total += n;
    if (n) console.log(`table ${ti} row ${ri}: ${n} controls · ${cells.length} cells · ${perCell.join(' | ')}`);
  });
});
const labels = ['Vorname Name:', 'Eintritt:', 'Austritt:', 'Bezeichnung der Maßnahme:', 'zuständige mitarbeitende Person:'];
console.log('labels found:', labels.map((l) => `${l} ${doc.split(l).length - 1}×`).join(', '));
console.log('controls total:', total, '· sdt in document:', (doc.match(/<w:sdt>/g) || []).length);
