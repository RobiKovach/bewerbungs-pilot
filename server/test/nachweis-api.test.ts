import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { ApplicationPackage, NachweisView, ProfileView } from '@bp/shared';
import { recognizeForm } from '../src/nachweis/build.js';
import { readDocx } from '../src/nachweis/docx.js';
import { pkg } from './helpers/applications.js';
import { H, makeApp } from './helpers/app.js';
import { makeDocx, multipartBody } from './helpers/files.js';
import { syntheticBbwBlank } from './helpers/nachweis-blanks.js';

type Ctx = Awaited<ReturnType<typeof makeApp>>;

const MEASURE = { audience: 'measure', personName: 'Robin Testfall', measure: { provider: 'Träger e. V.', name: 'Kurs Neu 2026', entry: '2026-08-17', exit: '', advisor: 'Frau Beraterin' }, office: null };
const JOBCENTER = { audience: 'jobcenter', personName: 'Robin Testfall', measure: null, office: { name: 'Jobcenter Dresden', customerNumber: '123A456', advisor: 'Herr V' } };

function submitted(id: string, at: string, over: Partial<ApplicationPackage> = {}): ApplicationPackage {
  return pkg({ id, vacancyId: `v-${id}`, status: 'sent', sentAt: at, history: [{ kind: 'sent', at }], ...over });
}
async function setup(): Promise<Ctx> {
  const ctx = await makeApp();
  ctx.applicationStore.save(submitted('a-old', '2026-11-03T10:00:00.000Z'), { vacancyText: '' });
  ctx.applicationStore.save(submitted('a-new', '2026-11-10T10:00:00.000Z', { status: 'submitted', sentAt: null, history: [{ kind: 'submitted', at: '2026-11-10T10:00:00.000Z' }] }), { vacancyText: '' });
  ctx.applicationStore.save(pkg({ id: 'a-draft', vacancyId: 'v-draft' }), { vacancyText: '' });
  return ctx;
}
const get = (ctx: Ctx, url: string) => ctx.app.inject({ method: 'GET', url });
const send = (ctx: Ctx, method: 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) =>
  ctx.app.inject({ method, url, headers: H, ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }) });
const view = async (ctx: Ctx) => (await get(ctx, '/api/nachweis')).json() as NachweisView;
const uploadBlank = async (ctx: Ctx, buf: Buffer, name = 'Bewerbungsnachweis.docx') =>
  ctx.app.inject({ method: 'POST', url: '/api/profile/nachweis/blank', ...multipartBody(name, buf) });
const err = (res: { json: () => { error: { code: string; reason?: string } } }) => res.json().error;
const profileFiles = (ctx: Ctx) => fs.readdirSync(ctx.filesDir);

describe('setup', () => {
  it('GET without setup → setup null, candidates list submitted packages only', async () => {
    const ctx = await setup();
    const v = await view(ctx);
    expect(v.setup).toBeNull();
    expect(v.candidates.map((c) => c.packageId)).toEqual(['a-old', 'a-new']);
    expect(v.candidates[0]).toMatchObject({ appliedAt: '2026-11-03T10:00:00.000Z', exportedAt: null, company: 'Muster GmbH' });
  });
  it('PUT setup then GET → setup with blank standard', async () => {
    const ctx = await setup();
    const res = await send(ctx, 'PUT', '/api/profile/nachweis', MEASURE);
    expect(res.statusCode).toBe(200);
    expect((res.json() as ProfileView).profile.nachweis).toMatchObject({ ...MEASURE, blank: { kind: 'standard' } });
    expect((await view(ctx)).setup).toMatchObject({ audience: 'measure', blank: { kind: 'standard' } });
  });
  it('PUT with measure data for a jobcenter → 400; a blank sent in the body is ignored (only the upload sets it)', async () => {
    const ctx = await setup();
    expect((await send(ctx, 'PUT', '/api/profile/nachweis', { ...JOBCENTER, measure: MEASURE.measure })).statusCode).toBe(400);
    expect(ctx.profileStore.get().nachweis).toBeNull();
    const fake = { kind: 'own', form: 'bbw-qgz-pp018', file: { id: '11111111-2222-4333-8444-555555555555', ext: '.docx', originalName: 'x.docx', size: 1, uploadedAt: '2026-11-27T10:00:00.000Z' } };
    expect((await send(ctx, 'PUT', '/api/profile/nachweis', { ...MEASURE, blank: fake })).statusCode).toBe(200);
    expect(ctx.profileStore.get().nachweis!.blank).toEqual({ kind: 'standard' });
  });
});

describe('own blank', () => {
  it('upload synthetic bbw blank with audience measure → blank own bbw-qgz-pp018', async () => {
    const ctx = await setup();
    await send(ctx, 'PUT', '/api/profile/nachweis', MEASURE);
    const res = await uploadBlank(ctx, await syntheticBbwBlank({ filledRows: 4 }));
    expect(res.statusCode).toBe(200);
    const blank = (res.json() as ProfileView).profile.nachweis!.blank;
    expect(blank).toMatchObject({ kind: 'own', form: 'bbw-qgz-pp018', file: { ext: '.docx', originalName: 'Bewerbungsnachweis.docx' } });
    expect(profileFiles(ctx)).toEqual([`${blank.kind === 'own' ? blank.file.id : ''}.docx`]);
  });
  it('a second upload replaces the first and removes its file', async () => {
    const ctx = await setup();
    await send(ctx, 'PUT', '/api/profile/nachweis', MEASURE);
    await uploadBlank(ctx, await syntheticBbwBlank());
    await uploadBlank(ctx, await syntheticBbwBlank());
    expect(profileFiles(ctx)).toHaveLength(1);
  });
  it('upload a CV docx → 400 NACHWEIS_FORM_UNKNOWN and no file left in profile dir', async () => {
    const ctx = await setup();
    await send(ctx, 'PUT', '/api/profile/nachweis', MEASURE);
    const res = await uploadBlank(ctx, makeDocx(['Lebenslauf Robin Testfall']));
    expect([res.statusCode, err(res).code]).toEqual([400, 'NACHWEIS_FORM_UNKNOWN']);
    expect(profileFiles(ctx)).toEqual([]);
    expect(ctx.profileStore.get().nachweis!.blank).toEqual({ kind: 'standard' });
  });
  it('upload a PDF → 415 FILE_TYPE_NOT_ALLOWED, nothing kept', async () => {
    const ctx = await setup();
    await send(ctx, 'PUT', '/api/profile/nachweis', MEASURE);
    const res = await uploadBlank(ctx, Buffer.from('%PDF-1.4\n%%EOF'), 'x.pdf');
    expect([res.statusCode, err(res).code]).toEqual([415, 'FILE_TYPE_NOT_ALLOWED']);
    expect(profileFiles(ctx)).toEqual([]);
  });
  it('upload with audience jobcenter → 400 nachweisFormAudience; without setup → 409 NACHWEIS_NOT_SET_UP', async () => {
    const ctx = await setup();
    const none = await uploadBlank(ctx, await syntheticBbwBlank());
    expect([none.statusCode, err(none).code]).toEqual([409, 'NACHWEIS_NOT_SET_UP']);
    await send(ctx, 'PUT', '/api/profile/nachweis', JOBCENTER);
    const res = await uploadBlank(ctx, await syntheticBbwBlank());
    expect([res.statusCode, err(res).reason]).toEqual([400, 'nachweisFormAudience']);
    expect(profileFiles(ctx)).toEqual([]);
  });
  it('switch audience to jobcenter → blank standard and the own file deleted', async () => {
    const ctx = await setup();
    await send(ctx, 'PUT', '/api/profile/nachweis', MEASURE);
    await uploadBlank(ctx, await syntheticBbwBlank());
    // Editing a measure setup keeps the own blank…
    await send(ctx, 'PUT', '/api/profile/nachweis', { ...MEASURE, personName: 'Robin T.' });
    expect(ctx.profileStore.get().nachweis!.blank.kind).toBe('own');
    // …switching away from a measure drops it.
    const res = await send(ctx, 'PUT', '/api/profile/nachweis', JOBCENTER);
    expect((res.json() as ProfileView).profile.nachweis!.blank).toEqual({ kind: 'standard' });
    expect(profileFiles(ctx)).toEqual([]);
  });
  it('DELETE blank → back to standard, file removed', async () => {
    const ctx = await setup();
    await send(ctx, 'PUT', '/api/profile/nachweis', MEASURE);
    await uploadBlank(ctx, await syntheticBbwBlank());
    const res = await send(ctx, 'DELETE', '/api/profile/nachweis/blank');
    expect((res.json() as ProfileView).profile.nachweis!.blank).toEqual({ kind: 'standard' });
    expect(profileFiles(ctx)).toEqual([]);
  });
});

describe('build and mark', () => {
  it('build returns a docx whose recognizeForm matches the setup; filename from first/last date; nothing marked', async () => {
    const ctx = await setup();
    await send(ctx, 'PUT', '/api/profile/nachweis', MEASURE);
    const std = await send(ctx, 'POST', '/api/nachweis/build', { applicationIds: ['a-new', 'a-old'] });
    expect(std.statusCode).toBe(200);
    expect(std.headers['content-type']).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(std.headers['content-disposition']).toBe('attachment; filename="Bewerbungsnachweis_03.11.2026_10.11.2026.docx"');
    expect(await recognizeForm(std.rawPayload)).toBeNull();
    const xml = (await readDocx(std.rawPayload)).xml.get('word/document.xml')!;
    expect(xml.indexOf('03.11.2026')).toBeLessThan(xml.indexOf('10.11.2026')); // oldest first

    await uploadBlank(ctx, await syntheticBbwBlank());
    const own = await send(ctx, 'POST', '/api/nachweis/build', { applicationIds: ['a-old'] });
    expect(own.statusCode).toBe(200);
    expect(own.headers['content-disposition']).toBe('attachment; filename="Bewerbungsnachweis_03.11.2026_03.11.2026.docx"');
    expect(await recognizeForm(own.rawPayload)).toBe('bbw-qgz-pp018');
    expect((await view(ctx)).candidates.every((c) => c.exportedAt === null)).toBe(true);
  });
  it('build holds the activity "nachweis" while it runs and releases it', async () => {
    const ctx = await setup();
    await send(ctx, 'PUT', '/api/profile/nachweis', MEASURE);
    const begin = vi.spyOn(ctx.activity, 'begin');
    expect((await send(ctx, 'POST', '/api/nachweis/build', { applicationIds: ['a-old'] })).statusCode).toBe(200);
    expect(begin).toHaveBeenCalledWith('nachweis');
    expect(ctx.activity.active()).toEqual([]);
  });
  it('build with a draft id → 409; unknown id → 404; empty list → 400; without setup → 409 NACHWEIS_NOT_SET_UP', async () => {
    const ctx = await setup();
    const noSetup = await send(ctx, 'POST', '/api/nachweis/build', { applicationIds: ['a-old'] });
    expect([noSetup.statusCode, err(noSetup).code]).toEqual([409, 'NACHWEIS_NOT_SET_UP']);
    await send(ctx, 'PUT', '/api/profile/nachweis', MEASURE);
    const draft = await send(ctx, 'POST', '/api/nachweis/build', { applicationIds: ['a-old', 'a-draft'] });
    expect([draft.statusCode, err(draft).code, err(draft).reason]).toEqual([409, 'CONFLICT', 'nachweisNotSubmitted']);
    expect((await send(ctx, 'POST', '/api/nachweis/build', { applicationIds: ['a-nope'] })).statusCode).toBe(404);
    expect((await send(ctx, 'POST', '/api/nachweis/build', { applicationIds: [] })).statusCode).toBe(400);
    expect((await send(ctx, 'POST', '/api/nachweis/build', { applicationIds: ['../x'] })).statusCode).toBe(400);
  });
  it('own blank file deleted on disk → 409 NACHWEIS_FORM_CHANGED', async () => {
    const ctx = await setup();
    await send(ctx, 'PUT', '/api/profile/nachweis', MEASURE);
    await uploadBlank(ctx, await syntheticBbwBlank());
    for (const f of profileFiles(ctx)) fs.rmSync(path.join(ctx.filesDir, f));
    const res = await send(ctx, 'POST', '/api/nachweis/build', { applicationIds: ['a-old'] });
    expect([res.statusCode, err(res).code]).toEqual([409, 'NACHWEIS_FORM_CHANGED']);
    expect(ctx.activity.active()).toEqual([]);
  });
  it('mark → candidates show exportedAt; marking twice adds a second entry and does not fail; updatedAt stays', async () => {
    const ctx = await setup();
    const before = ctx.applicationStore.require('a-old').updatedAt;
    const res = await send(ctx, 'POST', '/api/nachweis/mark', { applicationIds: ['a-old'], fileName: 'Bewerbungsnachweis_03.11.2026_03.11.2026.docx' });
    expect(res.statusCode).toBe(200);
    const v = res.json() as NachweisView;
    expect(v.candidates.find((c) => c.packageId === 'a-old')!.exportedAt).not.toBeNull();
    expect(v.candidates.find((c) => c.packageId === 'a-new')!.exportedAt).toBeNull();
    expect((await send(ctx, 'POST', '/api/nachweis/mark', { applicationIds: ['a-old'], fileName: 'zweite.docx' })).statusCode).toBe(200);
    const p = ctx.applicationStore.require('a-old');
    expect(p.history.filter((h) => h.kind === 'nachweis').map((h) => h.note)).toEqual(['Bewerbungsnachweis_03.11.2026_03.11.2026.docx', 'zweite.docx']);
    expect(p.updatedAt).toBe(before);
    expect((await send(ctx, 'POST', '/api/nachweis/mark', { applicationIds: ['a-draft'], fileName: 'x.docx' })).statusCode).toBe(409);
    expect((await send(ctx, 'POST', '/api/nachweis/mark', { applicationIds: ['a-old'], fileName: 'x'.repeat(201) })).statusCode).toBe(400);
  });
});

describe('with backups', () => {
  it('transfer export → import on a fresh data dir keeps setup, own blank and marks', async () => {
    const ctx = await setup();
    await send(ctx, 'PUT', '/api/profile/nachweis', MEASURE);
    await uploadBlank(ctx, await syntheticBbwBlank());
    await send(ctx, 'POST', '/api/nachweis/mark', { applicationIds: ['a-old'], fileName: 'n.docx' });
    const zip = await send(ctx, 'POST', '/api/transfer/export', {});
    expect(zip.statusCode).toBe(200);

    const other = await makeApp();
    const back = await other.app.inject({ method: 'POST', url: '/api/backups/restore-upload', ...multipartBody('file.zip', zip.rawPayload) });
    expect(back.statusCode).toBe(200);
    expect(other.profileStore.get().nachweis).toMatchObject({ audience: 'measure', blank: { kind: 'own', form: 'bbw-qgz-pp018' } });
    const built = await send(other, 'POST', '/api/nachweis/build', { applicationIds: ['a-old'] });
    expect(await recognizeForm(built.rawPayload)).toBe('bbw-qgz-pp018');
    expect((await view(other)).candidates.find((c) => c.packageId === 'a-old')!.exportedAt).not.toBeNull();
  });
  it('restore refused while a build is running', async () => {
    const ctx = await setup();
    const saved = await send(ctx, 'POST', '/api/backups', {});
    expect(saved.statusCode).toBe(200);
    const end = ctx.activity.begin('nachweis');
    const res = await send(ctx, 'POST', '/api/backups/restore', { name: saved.json().name });
    expect([res.statusCode, err(res).reason]).toEqual([409, 'restoreBusyExport']);
    end();
  });
  it('build refused during a restore', async () => {
    const ctx = await setup();
    await send(ctx, 'PUT', '/api/profile/nachweis', MEASURE);
    const end = ctx.activity.begin('restore');
    const res = await send(ctx, 'POST', '/api/nachweis/build', { applicationIds: ['a-old'] });
    expect([res.statusCode, err(res).reason]).toEqual([409, 'restoreRunning']);
    end();
  });
});
