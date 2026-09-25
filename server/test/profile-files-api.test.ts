import { describe, it, expect, vi } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { H, makeApp } from './helpers/app.js';
import { JPG_BYTES, multipartBody, PDF_BYTES, PNG_BYTES } from './helpers/files.js';

type App = Awaited<ReturnType<typeof makeApp>>['app'];
const post = (app: App, url: string, name: string, bytes: Buffer) => app.inject({ method: 'POST', url, ...multipartBody(name, bytes) });

describe('photo and documents API', () => {
  it('stores a photo and replaces the old one', async () => {
    const { app, filesDir } = await makeApp();
    const first = await post(app, '/api/profile/files?kind=photo', 'me.png', PNG_BYTES);
    expect(first.statusCode).toBe(200);
    const photo1 = first.json().profile.photo;
    expect(photo1).toMatchObject({ ext: '.png', originalName: 'me.png' });
    const second = await post(app, '/api/profile/files?kind=photo', 'me2.jpg', JPG_BYTES);
    const photo2 = second.json().profile.photo;
    expect(photo2.ext).toBe('.jpg');
    expect(fs.readdirSync(filesDir)).toEqual([`${photo2.id}.jpg`]);
    expect(photo1.id).not.toBe(photo2.id);
  });

  it('keeps the new photo even when deleting the old one fails', async () => {
    const { app, filesDir, profileFiles } = await makeApp();
    const first = await post(app, '/api/profile/files?kind=photo', 'me.png', PNG_BYTES);
    const oldId = first.json().profile.photo.id;
    const spy = vi.spyOn(profileFiles, 'remove').mockImplementation((file) => {
      if (file.id === oldId) throw new Error('simulated Windows file lock');
    });
    const second = await post(app, '/api/profile/files?kind=photo', 'me2.jpg', JPG_BYTES);
    expect(second.statusCode).toBe(200);
    const photo2 = second.json().profile.photo;
    expect(photo2.id).not.toBe(oldId);
    expect(fs.existsSync(path.join(filesDir, `${photo2.id}.jpg`))).toBe(true);
    spy.mockRestore();
  });

  it('keeps a Cyrillic file name as the label and stores the file under a generated name', async () => {
    const { app, filesDir } = await makeApp();
    const res = await post(app, '/api/profile/files?kind=document&attachAlways=1', 'Zeugnis Ольга Коваль.pdf', PDF_BYTES);
    expect(res.statusCode).toBe(200);
    const doc = res.json().profile.documents[0];
    expect(doc).toMatchObject({ originalName: 'Zeugnis Ольга Коваль.pdf', label: 'Zeugnis Ольга Коваль', attachAlways: true, ext: '.pdf' });
    expect(fs.readdirSync(filesDir)).toEqual([`${doc.id}.pdf`]);
  });

  it('uses a given label', async () => {
    const { app } = await makeApp();
    const res = await post(app, `/api/profile/files?kind=document&label=${encodeURIComponent('Zeugnis Ausbildung')}`, 'scan.pdf', PDF_BYTES);
    expect(res.json().profile.documents[0]).toMatchObject({ label: 'Zeugnis Ausbildung', attachAlways: false });
  });

  it('refuses a wrong type and leaves nothing behind', async () => {
    const { app, filesDir } = await makeApp();
    const res = await post(app, '/api/profile/files?kind=document', 'photo.pdf', JPG_BYTES);
    expect(res.statusCode).toBe(415);
    expect(res.json().error.code).toBe('FILE_TYPE_NOT_ALLOWED');
    expect(fs.readdirSync(filesDir)).toEqual([]);
  });

  it('refuses a too large photo and leaves nothing behind', async () => {
    const { app, filesDir } = await makeApp();
    const big = Buffer.concat([PNG_BYTES, Buffer.alloc(5 * 1024 * 1024)]);
    const res = await post(app, '/api/profile/files?kind=photo', 'big.png', big);
    expect(res.statusCode).toBe(413);
    expect(res.json().error.code).toBe('FILE_TOO_LARGE');
    expect(fs.readdirSync(filesDir)).toEqual([]);
  });

  it('refuses a 21st document', async () => {
    const { app, profileStore } = await makeApp();
    profileStore.update((p) => {
      for (let i = 0; i < 20; i++) {
        p.documents.push({ id: crypto.randomUUID(), ext: '.pdf', originalName: `d${i}.pdf`, size: 1, uploadedAt: '2026-09-24T10:00:00.000Z', label: `d${i}`, attachAlways: false });
      }
    });
    const res = await post(app, '/api/profile/files?kind=document', 'one-more.pdf', PDF_BYTES);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('TOO_MANY_FILES');
  });

  it('refuses a request without a file and an unknown kind', async () => {
    const { app } = await makeApp();
    const noFile = await app.inject({ method: 'POST', url: '/api/profile/files?kind=photo', headers: { ...H, 'content-type': 'application/json' }, payload: {} });
    expect(noFile.statusCode).toBe(400);
    const badKind = await post(app, '/api/profile/files?kind=cv', 'cv.pdf', PDF_BYTES);
    expect(badKind.statusCode).toBe(400);
  });

  it('serves, renames and deletes a document', async () => {
    const { app, filesDir } = await makeApp();
    const doc = (await post(app, '/api/profile/files?kind=document', 'z.pdf', PDF_BYTES)).json().profile.documents[0];
    const file = await app.inject({ method: 'GET', url: `/api/profile/files/${doc.id}` });
    expect(file.statusCode).toBe(200);
    expect(file.headers['content-type']).toBe('application/pdf');
    expect(file.headers['cache-control']).toBe('no-store');
    expect(file.rawPayload.equals(PDF_BYTES)).toBe(true);
    const renamed = await app.inject({ method: 'PUT', url: `/api/profile/files/${doc.id}`, headers: H, payload: { label: 'Arbeitszeugnis', attachAlways: true } });
    expect(renamed.json().profile.documents[0]).toMatchObject({ label: 'Arbeitszeugnis', attachAlways: true });
    const deleted = await app.inject({ method: 'DELETE', url: `/api/profile/files/${doc.id}`, headers: H });
    expect(deleted.json().profile.documents).toEqual([]);
    expect(fs.readdirSync(filesDir)).toEqual([]);
  });

  it('deletes a document from the profile even when removing its file fails', async () => {
    const { app, profileFiles } = await makeApp();
    const doc = (await post(app, '/api/profile/files?kind=document', 'z.pdf', PDF_BYTES)).json().profile.documents[0];
    const spy = vi.spyOn(profileFiles, 'remove').mockImplementation(() => { throw new Error('simulated Windows file lock'); });
    const deleted = await app.inject({ method: 'DELETE', url: `/api/profile/files/${doc.id}`, headers: H });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json().profile.documents).toEqual([]);
    const reread = await app.inject({ method: 'GET', url: '/api/profile' });
    expect(reread.json().profile.documents).toEqual([]);
    spy.mockRestore();
  });

  it('answers 404 for unknown ids and path tricks', async () => {
    const { app } = await makeApp();
    expect((await app.inject({ method: 'GET', url: `/api/profile/files/${crypto.randomUUID()}` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/profile/files/..%2Fprofile.json' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: `/api/profile/files/${crypto.randomUUID()}`, headers: H })).statusCode).toBe(404);
  });
});
