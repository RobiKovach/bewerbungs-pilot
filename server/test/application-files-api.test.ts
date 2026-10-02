import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import type { Profile } from '@bp/shared';
import { countPages } from '../src/applications/pdf.js';
import { H, makeApp } from './helpers/app.js';
import { FakePrinter, makePdf, packageClaude, readyPackageProfile } from './helpers/applications.js';
import { vacancy } from './helpers/vacancies.js';

const OFFER = 'Wir suchen einen Webentwickler (m/w/d) für unser Team in Hamburg. '.repeat(12);
const DOC_A = '11111111-2222-4333-8444-555555555555';
const DOC_B = '22222222-2222-4333-8444-555555555555';
const doc = (id: string, label: string) => ({ id, ext: '.pdf' as const, originalName: `${label}.pdf`, size: 100, uploadedAt: '2026-09-01T10:00:00.000Z', label, attachAlways: true });

async function setup(change: (p: Profile) => void = () => {}, printer?: FakePrinter) {
  const ctx = await makeApp({ provider: packageClaude(), printer });
  ctx.profileStore.update((p) => { Object.assign(p, readyPackageProfile(change)); });
  ctx.vacancyStore.add(vacancy({ id: 'fav1', status: 'favorite', company: 'Müller & Söhne GmbH', locations: ['Hamburg'] }), OFFER);
  await ctx.app.inject({ method: 'POST', url: '/api/applications', headers: H, payload: { vacancyId: 'fav1', language: 'de' } });
  await ctx.applicationJob.whenIdle();
  const id = ctx.applicationJob.state().applicationId!;
  return { ctx, id, get: (url: string) => ctx.app.inject({ method: 'GET', url }) };
}

describe('preview', () => {
  it('letter and CV previews are HTML the dashboard may frame, without scripts, and cost no Claude call', async () => {
    const { ctx, id, get } = await setup();
    const calls = ctx.provider.calls.length;
    for (const kind of ['letter', 'cv']) {
      const r = await get(`/api/applications/${id}/preview/${kind}`);
      expect(r.statusCode).toBe(200);
      expect(r.headers['content-type']).toContain('text/html');
      expect(r.headers['x-frame-options']).toBe('SAMEORIGIN');
      expect(r.headers['content-security-policy']).toBe("default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'self'");
      expect(r.body).not.toMatch(/<script/i);
    }
    expect((await get(`/api/applications/${id}/preview/letter`)).body).toContain('Müller &amp; Söhne GmbH');
    expect(ctx.provider.calls.length).toBe(calls);
    expect((await get('/api/health')).headers['x-frame-options']).toBe('DENY');
  });
  it('the CV preview shows the package\'s own photo copy', async () => {
    const photoId = '33333333-2222-4333-8444-555555555555';
    const { ctx, get } = await (async () => {
      const made = await makeApp({ provider: packageClaude() });
      made.profileStore.update((p) => { Object.assign(p, readyPackageProfile((x) => { x.photo = { id: photoId, ext: '.jpg', originalName: 'me.jpg', size: 3, uploadedAt: '2026-09-01T10:00:00.000Z' }; })); });
      fs.writeFileSync(made.profileFiles.pathOf({ id: photoId, ext: '.jpg' }), Buffer.from([0xff, 0xd8, 0xff]));
      made.vacancyStore.add(vacancy({ id: 'fav1', status: 'favorite' }), OFFER);
      await made.app.inject({ method: 'POST', url: '/api/applications', headers: H, payload: { vacancyId: 'fav1', language: 'de' } });
      await made.applicationJob.whenIdle();
      return { ctx: made, get: (url: string) => made.app.inject({ method: 'GET', url }) };
    })();
    const id = ctx.applicationJob.state().applicationId!;
    fs.rmSync(ctx.profileFiles.pathOf({ id: photoId, ext: '.jpg' })); // the profile photo is gone; the package keeps its copy
    expect((await get(`/api/applications/${id}/preview/cv`)).body).toContain('src="data:image/jpeg;base64,/9j/"');
  });
});

describe('PDF downloads', () => {
  it('letter and CV: application/pdf with safe ASCII file names', async () => {
    const { id, get } = await setup();
    const letter = await get(`/api/applications/${id}/pdf/letter`);
    expect(letter.headers['content-type']).toBe('application/pdf');
    expect(letter.headers['content-disposition']).toBe('attachment; filename="Anschreiben_Max_Mustermann_Mueller_Soehne_GmbH.pdf"');
    expect(letter.rawPayload.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect((await get(`/api/applications/${id}/pdf/cv`)).headers['content-disposition']).toBe('attachment; filename="Lebenslauf_Max_Mustermann.pdf"');
  });
  it('no browser → 503 BROWSER_MISSING', async () => {
    const printer = new FakePrinter();
    const { id, get } = await setup(() => {}, printer);
    printer.isAvailable = false;
    const r = await get(`/api/applications/${id}/pdf/letter`);
    expect(r.statusCode).toBe(503);
    expect(r.json().error.code).toBe('BROWSER_MISSING');
  });
  it('an attachment only when it belongs to the package and still exists in the profile', async () => {
    const { ctx, id, get } = await setup((p) => { p.documents = [doc(DOC_A, 'Zeugnis 2020')]; });
    fs.writeFileSync(ctx.profileFiles.pathOf({ id: DOC_A, ext: '.pdf' }), await makePdf(2));
    const r = await get(`/api/applications/${id}/pdf/attachment/${DOC_A}`);
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-disposition']).toBe('attachment; filename="Zeugnis_2020.pdf"');
    expect((await get(`/api/applications/${id}/pdf/attachment/${DOC_B}`)).statusCode).toBe(404);
  });
  it('bundle: letter + CV + chosen existing attachments, in that order; missing ones are left out', async () => {
    const { ctx, id, get } = await setup((p) => { p.documents = [doc(DOC_A, 'Zeugnis'), doc(DOC_B, 'Zertifikat')]; });
    fs.writeFileSync(ctx.profileFiles.pathOf({ id: DOC_A, ext: '.pdf' }), await makePdf(2));
    fs.writeFileSync(ctx.profileFiles.pathOf({ id: DOC_B, ext: '.pdf' }), await makePdf(3));
    let r = await get(`/api/applications/${id}/pdf/bundle`);
    expect(r.headers['content-disposition']).toBe('attachment; filename="Bewerbung_Max_Mustermann_Mueller_Soehne_GmbH.pdf"');
    expect(await countPages(r.rawPayload)).toBe(1 + 1 + 2 + 3);
    ctx.profileStore.update((p) => { p.documents = [p.documents[0]]; });
    r = await get(`/api/applications/${id}/pdf/bundle`);
    expect(await countPages(r.rawPayload)).toBe(1 + 1 + 2);
  });
  it('bundle with a damaged attachment → 409 attachmentUnreadable naming it', async () => {
    const { ctx, id, get } = await setup((p) => { p.documents = [doc(DOC_A, 'Zeugnis 2020')]; });
    fs.writeFileSync(ctx.profileFiles.pathOf({ id: DOC_A, ext: '.pdf' }), 'kaputt');
    const r = await get(`/api/applications/${id}/pdf/bundle`);
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toMatchObject({ code: 'CONFLICT', reason: 'attachmentUnreadable', params: { name: 'Zeugnis 2020' } });
  });
});
