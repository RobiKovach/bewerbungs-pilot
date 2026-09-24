import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AppError } from '../src/errors.js';
import { cleanOriginalName, detectExt, FILE_ID_PATTERN, ProfileFiles } from '../src/profile/files.js';
import { JPG_BYTES, makeZip, PDF_BYTES, PNG_BYTES } from './helpers/files.js';

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bp Файли-'));
function upload(files: ProfileFiles, bytes: Buffer): string {
  const p = files.newUploadPath();
  fs.writeFileSync(p, bytes);
  return p;
}

describe('detectExt', () => {
  it('recognises files by their first bytes', () => {
    expect(detectExt(PDF_BYTES, 'a.pdf')).toBe('.pdf');
    expect(detectExt(PNG_BYTES, 'a.png')).toBe('.png');
    expect(detectExt(JPG_BYTES, 'a.jpeg')).toBe('.jpg');
    expect(detectExt(makeZip({ 'a.txt': 'x' }), 'Lebenslauf.DOCX')).toBe('.docx');
  });
  it('does not trust the name', () => {
    expect(detectExt(Buffer.from('hello'), 'cv.pdf')).toBeNull();
    expect(detectExt(JPG_BYTES, 'photo.pdf')).toBe('.jpg');
    expect(detectExt(makeZip({ 'a.txt': 'x' }), 'table.xlsx')).toBeNull();
    expect(detectExt(Buffer.alloc(0), 'empty.pdf')).toBeNull();
  });
  it('accepts a PDF with a few junk bytes before the header', () => {
    expect(detectExt(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf, 0x0a]), PDF_BYTES]), 'x.pdf')).toBe('.pdf');
  });
});

describe('cleanOriginalName', () => {
  it('keeps Cyrillic and spaces, drops folders and control characters', () => {
    expect(cleanOriginalName('C:\\Users\\Ольга\\Резюме Ольга Коваль.pdf')).toBe('Резюме Ольга Коваль.pdf');
    expect(cleanOriginalName('a\u0007b<c>.pdf')).toBe('ab_c_.pdf');
    expect(cleanOriginalName('   ')).toBe('file');
  });
});

describe('ProfileFiles', () => {
  it('stores an allowed upload under a generated name', () => {
    const dir = tempDir();
    const files = new ProfileFiles(dir);
    const stored = files.adopt(upload(files, PDF_BYTES), 'cv', 'Резюме Ольга.pdf');
    expect(stored).toMatchObject({ ext: '.pdf', originalName: 'Резюме Ольга.pdf', size: PDF_BYTES.length });
    expect(stored.id).toMatch(FILE_ID_PATTERN);
    expect(fs.readdirSync(dir)).toEqual([`${stored.id}.pdf`]);
    expect(files.exists(stored)).toBe(true);
    files.remove(stored);
    expect(fs.readdirSync(dir)).toEqual([]);
  });
  it('rejects a type that is not allowed for this kind and deletes the upload', () => {
    const dir = tempDir();
    const files = new ProfileFiles(dir);
    const err = (() => { try { files.adopt(upload(files, PNG_BYTES), 'cv', 'cv.png'); } catch (e) { return e; } })();
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('FILE_TYPE_NOT_ALLOWED');
    expect(fs.readdirSync(dir)).toEqual([]);
    expect(() => files.adopt(upload(files, PDF_BYTES), 'photo', 'x.pdf')).toThrow(/FILE_TYPE_NOT_ALLOWED/);
    expect(() => files.adopt(upload(files, makeZip({ a: 'b' })), 'document', 'x.docx')).toThrow(/FILE_TYPE_NOT_ALLOWED/);
  });
});
