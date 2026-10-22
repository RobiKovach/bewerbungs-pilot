import { describe, it, expect } from 'vitest';
import type { ApplicationJobState, ApplicationView } from '@bp/shared';
import type { Logger } from '../src/log.js';
import { H, makeApp } from './helpers/app.js';
import { GOOD_LETTER, packageClaude, readyPackageProfile } from './helpers/applications.js';
import { vacancy } from './helpers/vacancies.js';

const OFFER = 'Wir suchen einen Webentwickler (m/w/d) für unser Team in Hamburg. Sie bauen mit uns Online-Shops für den Handel. '.repeat(8);
const IBAN = 'DE89370400440532013000';

type Ctx = Awaited<ReturnType<typeof makeApp>>;
async function setup(logger?: Logger) {
  const ctx = await makeApp({ provider: packageClaude(), logger });
  ctx.profileStore.update((p) => { Object.assign(p, readyPackageProfile()); });
  ctx.vacancyStore.add(vacancy({ id: 'fav1', status: 'favorite', company: 'Muster GmbH', locations: ['Hamburg'] }), OFFER);
  return ctx;
}
const get = (ctx: Ctx, url: string) => ctx.app.inject({ method: 'GET', url });
const send = (ctx: Ctx, method: 'POST' | 'PATCH', url: string, payload: Record<string, unknown>) =>
  ctx.app.inject({ method, url, headers: H, payload });
async function created(ctx: Ctx): Promise<string> {
  await send(ctx, 'POST', '/api/applications', { vacancyId: 'fav1', language: 'de' });
  await ctx.applicationJob.whenIdle();
  return ((await get(ctx, '/api/applications/job')).json() as ApplicationJobState).applicationId!;
}

describe('personal-data warnings in the package view', () => {
  it('an IBAN in a letter paragraph is one warning with its place; removing it clears the warnings', async () => {
    const ctx = await setup();
    const id = await created(ctx);
    expect(((await get(ctx, `/api/applications/${id}`)).json() as ApplicationView).warnings).toEqual([]);
    const withIban = [GOOD_LETTER.paragraphs[0], `Mein Konto: ${IBAN}.`, GOOD_LETTER.paragraphs[2]];
    const patched = (await send(ctx, 'PATCH', `/api/applications/${id}/letter`, { paragraphs: withIban })).json() as ApplicationView;
    expect(patched.warnings).toEqual([{ kind: 'iban', value: IBAN, where: { part: 'letter', field: 'paragraph', index: 2 } }]);
    expect(((await get(ctx, `/api/applications/${id}`)).json() as ApplicationView).warnings).toHaveLength(1);
    const cleaned = (await send(ctx, 'PATCH', `/api/applications/${id}/letter`, { paragraphs: GOOD_LETTER.paragraphs })).json() as ApplicationView;
    expect(cleaned.warnings).toEqual([]);
  });
});

describe('POST /api/applications/:id/check-text', () => {
  it('finds an unknown email in the body of an email window', async () => {
    const ctx = await setup();
    const id = await created(ctx);
    const r = await send(ctx, 'POST', `/api/applications/${id}/check-text`, { subject: 'Nachfrage', body: 'Bitte antworten Sie an evil@x.example.' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ warnings: [{ kind: 'email', value: 'evil@x.example', where: { part: 'email', field: 'body' } }] });
  });
  it('clean text → no warnings', async () => {
    const ctx = await setup();
    const id = await created(ctx);
    const r = await send(ctx, 'POST', `/api/applications/${id}/check-text`, { subject: 'Nachfrage', body: 'Gibt es schon Neuigkeiten?' });
    expect(r.json()).toEqual({ warnings: [] });
  });
  it('refusals: extra key / too long → 400; unknown package → 404; without launch key → 401 NO_SESSION', async () => {
    const ctx = await setup();
    const id = await created(ctx);
    expect((await send(ctx, 'POST', `/api/applications/${id}/check-text`, { subject: 'a', body: 'b', to: 'x@y.de' })).statusCode).toBe(400);
    expect((await send(ctx, 'POST', `/api/applications/${id}/check-text`, { subject: 'a'.repeat(501), body: 'b' })).statusCode).toBe(400);
    expect((await send(ctx, 'POST', `/api/applications/${id}/check-text`, { subject: 'a', body: 'b'.repeat(20001) })).statusCode).toBe(400);
    expect((await send(ctx, 'POST', '/api/applications/app-nope/check-text', { subject: 'a', body: 'b' })).statusCode).toBe(404);
    const noKey = await ctx.app.inject({ method: 'POST', url: `/api/applications/${id}/check-text`, headers: { 'x-bp-client': '1', 'x-bp-key': '' }, payload: { subject: 'a', body: 'b' } });
    expect(noKey.statusCode).toBe(401);
    expect(noKey.json().error.code).toBe('NO_SESSION');
  });
  it('found values never reach the log', async () => {
    const lines: string[] = [];
    const log = (e: string, d?: unknown) => { lines.push(JSON.stringify({ e, d })); };
    const ctx = await setup({ info: log, warn: log, error: log });
    const id = await created(ctx);
    await send(ctx, 'PATCH', `/api/applications/${id}/letter`, { paragraphs: [`Konto ${IBAN}`] });
    await get(ctx, `/api/applications/${id}`);
    await send(ctx, 'POST', `/api/applications/${id}/check-text`, { subject: 'a', body: `Konto ${IBAN}` });
    await send(ctx, 'POST', `/api/applications/${id}/check-text`, { subject: 'a', body: `Konto ${IBAN}`, extra: 1 });
    await send(ctx, 'POST', `/api/applications/${id}/check-package`, { letter: { paragraphs: [`Konto ${IBAN}`] }, profil: `Konto ${IBAN}` });
    // The package job logs too (it got the same logger): its lines are checked as well.
    expect(lines.some((l) => l.includes('application'))).toBe(true);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join('\n')).not.toContain(IBAN);
  });
});

describe('the package view never fails because of the warning check', () => {
  it('a locked vacancy text (EBUSY) still gives the package with warnings from the profile only', async () => {
    const ctx = await setup();
    const id = await created(ctx);
    const busy = () => { throw Object.assign(new Error('locked'), { code: 'EBUSY' }); };
    ctx.applicationStore.readVacancyText = busy;
    ctx.vacancyStore.readText = busy;
    const r = await get(ctx, `/api/applications/${id}`);
    expect(r.statusCode).toBe(200);
    expect((r.json() as ApplicationView).warnings).toEqual([]);
  });
});

describe('POST /api/applications/:id/check-package (unsaved editor text)', () => {
  it('checks unsaved letter and CV text without storing anything', async () => {
    const ctx = await setup();
    const id = await created(ctx);
    const before = ctx.applicationStore.require(id).updatedAt;
    const r = await send(ctx, 'POST', `/api/applications/${id}/check-package`, {
      letter: { paragraphs: [GOOD_LETTER.paragraphs[0], `Konto ${IBAN}`, ''] }, profil: 'Erreichbar unter evil@x.example',
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().warnings).toEqual([
      { kind: 'iban', value: IBAN, where: { part: 'letter', field: 'paragraph', index: 2 } },
      { kind: 'email', value: 'evil@x.example', where: { part: 'cv', field: 'profil' } },
    ]);
    expect(ctx.applicationStore.require(id).updatedAt).toBe(before);
    expect(((await get(ctx, `/api/applications/${id}`)).json() as ApplicationView).warnings).toEqual([]);
  });
  it('an empty body checks the saved package; unknown fields and oversize text are refused', async () => {
    const ctx = await setup();
    const id = await created(ctx);
    expect((await send(ctx, 'POST', `/api/applications/${id}/check-package`, {})).json().warnings).toEqual([]);
    expect((await send(ctx, 'POST', `/api/applications/${id}/check-package`, { letter: { pages: 3 } })).statusCode).toBe(400);
    expect((await send(ctx, 'POST', `/api/applications/${id}/check-package`, { profil: 'a'.repeat(5000) })).statusCode).toBe(400);
  });
});
