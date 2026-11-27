import yauzl from 'yauzl';
import yazl from 'yazl';
import { AppError } from '../errors.js';

/** A .docx opened for filling (0.15.0): every *.xml / *.rels part as text, everything else (images, fonts) as bytes. */
export interface DocxParts { xml: Map<string, string>; binary: Map<string, Buffer> }

const MAX_ENTRIES = 200;
const MAX_UNPACKED = 20 * 1024 * 1024;
const isXmlPart = (name: string) => /\.(xml|rels)$/i.test(name);
const unknown = (why: string) => new AppError('NACHWEIS_FORM_UNKNOWN', `not a usable .docx: ${why}`);

/** Opens a Word file. Anything that is not a small, plain .docx (foreign paths, too many or too big parts) is refused. */
export function readDocx(buf: Buffer): Promise<DocxParts> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buf, { lazyEntries: true, decodeStrings: true, validateEntrySizes: true }, (err, zip) => {
      if (err || !zip) return reject(unknown(String(err)));
      const parts: DocxParts = { xml: new Map(), binary: new Map() };
      let count = 0;
      let total = 0;
      const fail = (e: AppError) => { zip.close(); reject(e); };
      zip.on('error', (e: unknown) => reject(unknown(String(e))));
      zip.on('entry', (entry: yauzl.Entry) => {
        const name = entry.fileName;
        if (name.endsWith('/')) return zip.readEntry();
        if (++count > MAX_ENTRIES) return fail(unknown('too many parts'));
        if (name.includes('\\') || name.startsWith('/') || name.split('/').includes('..')) return fail(unknown(`bad part name ${name}`));
        total += entry.uncompressedSize;
        if (total > MAX_UNPACKED) return fail(unknown('too big'));
        zip.openReadStream(entry, (e2, stream) => {
          if (e2 || !stream) return fail(unknown(String(e2)));
          const chunks: Buffer[] = [];
          stream.on('data', (c: Buffer) => chunks.push(c));
          stream.on('error', (e3: unknown) => fail(unknown(String(e3))));
          stream.on('end', () => {
            const data = Buffer.concat(chunks);
            if (isXmlPart(name)) parts.xml.set(name, data.toString('utf8'));
            else parts.binary.set(name, data);
            zip.readEntry();
          });
        });
      });
      zip.on('end', () => {
        if (!parts.xml.has('word/document.xml')) return reject(unknown('no word/document.xml'));
        resolve(parts);
      });
      zip.readEntry();
    });
  });
}

/** Zips the parts back into a .docx: [Content_Types].xml first (Word expects it), forward slashes in every name. */
export function writeDocx(parts: DocxParts): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile();
    const names = [...parts.xml.keys(), ...parts.binary.keys()].sort((a, b) => (a === '[Content_Types].xml' ? -1 : b === '[Content_Types].xml' ? 1 : 0));
    for (const name of names) {
      const xml = parts.xml.get(name);
      zip.addBuffer(xml !== undefined ? Buffer.from(xml, 'utf8') : parts.binary.get(name)!, name.replace(/\\/g, '/'));
    }
    const chunks: Buffer[] = [];
    zip.outputStream.on('data', (c: Buffer) => chunks.push(c));
    zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
    zip.outputStream.on('error', reject);
    zip.end();
  });
}
