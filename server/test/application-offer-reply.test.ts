import { describe, it, expect } from 'vitest';
import type { MailDraft } from '@bp/shared';
import { H } from './helpers/app.js';
import { packageClaude } from './helpers/applications.js';
import { type Ctx, post, sendTo, setup, viewOf } from './helpers/sending.js';

const AMOUNTS = { offered: '48.000 €', wanted: '55.000 €' };
const GOOD = 'Sehr geehrte Frau Weiler, ich freue mich über das Angebot. 55.000 € wären für mich passend. Max Mustermann';
const url = (id: string, path = 'offer-reply') => `/api/applications/${id}/${path}`;
const patch = (ctx: Ctx, id: string, payload: unknown) => ctx.app.inject({ method: 'PATCH', url: url(id), headers: H, payload: payload as Record<string, unknown> });

async function offerPackage(offer?: NonNullable<Parameters<typeof packageClaude>[0]>['offer']) {
  const r = await setup({ contact: true });
  r.ctx.provider.respond = packageClaude({ offer: offer ?? { body: GOOD } }).respond;
  expect((await sendTo(r.ctx, r.id)).statusCode).toBe(200);
  expect((await post(r.ctx, `/api/applications/${r.id}/status`, { status: 'offer', date: '2026-10-08' })).statusCode).toBe(200);
  r.ctx.provider.calls.length = 0;
  return r;
}

describe('offer reply', () => {
  it('Claude writes it: stored with both amounts, history and status unchanged', async () => {
    const { ctx, id } = await offerPackage();
    const before = await viewOf(ctx, id);
    const r = await post(ctx, url(id), AMOUNTS);
    expect(r.statusCode).toBe(200);
    const v = await viewOf(ctx, id);
    expect(v.application.offerReply).toMatchObject({ ...AMOUNTS, body: GOOD });
    expect(v.application.offerReply!.createdAt).toBe(v.application.offerReply!.updatedAt);
    expect(v.application.history).toEqual(before.application.history);
    expect(v.application.status).toBe('offer');
  });

  it('one retry with the complaints, then success', async () => {
    let n = 0;
    const { ctx, id } = await offerPackage(() => ({ body: n++ === 0 ? 'Danke für das Angebot.' : GOOD }));
    const r = await post(ctx, url(id), AMOUNTS);
    expect(r.statusCode).toBe(200);
    expect(ctx.provider.calls).toHaveLength(2);
    expect(ctx.provider.calls[1].prompt).toContain('previous answer broke these rules');
    expect((await viewOf(ctx, id)).application.offerReply!.body).toBe(GOOD);
  });

  it('a "never mention" item twice → LLM_BAD_OUTPUT and the package is unchanged', async () => {
    const { ctx, id } = await offerPackage({ body: 'Wie bei Kunde X: 55.000 €' });
    const r = await post(ctx, url(id), AMOUNTS);
    expect(r.statusCode).toBe(500); // LLM_BAD_OUTPUT has no dedicated HTTP status in httpStatusFor
    expect(r.json().error.code).toBe('LLM_BAD_OUTPUT');
    expect(ctx.provider.calls).toHaveLength(2);
    expect((await viewOf(ctx, id)).application.offerReply).toBeNull();
  });

  it('refuses a package that is not an offer and bad amounts', async () => {
    const sent = await setup({ contact: true });
    await sendTo(sent.ctx, sent.id);
    expect((await post(sent.ctx, url(sent.id), AMOUNTS)).statusCode).toBe(409);
    const { ctx, id } = await offerPackage();
    expect((await post(ctx, url(id), { offered: '48.000 €', wanted: 'viel' })).statusCode).toBe(400);
    expect((await post(ctx, url(id), { offered: '48.000\n€', wanted: '55.000 €' })).statusCode).toBe(400);
    expect((await post(ctx, url(id), { offered: '48.000 €', wanted: '5'.repeat(51) })).statusCode).toBe(400);
    expect(ctx.provider.calls).toHaveLength(0);
  });

  it('two quick requests: the second gets CONFLICT, one Claude run', async () => {
    const { ctx, id } = await offerPackage(async () => { await new Promise((res) => setTimeout(res, 50)); return { body: GOOD }; });
    const [a, b] = await Promise.all([post(ctx, url(id), AMOUNTS), post(ctx, url(id), AMOUNTS)]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
    expect(ctx.provider.calls).toHaveLength(1);
  });

  it('PATCH saves the edited text (updatedAt changes) and the reply draft returns it', async () => {
    const { ctx, id } = await offerPackage();
    expect((await patch(ctx, id, { body: 'x' })).statusCode).toBe(409);
    await post(ctx, url(id), AMOUNTS);
    const first = (await viewOf(ctx, id)).application.offerReply!;
    await new Promise((res) => setTimeout(res, 5));
    expect((await patch(ctx, id, { body: '' })).statusCode).toBe(400);
    expect((await patch(ctx, id, { body: 'Mein eigener Text, 55.000 €.' })).statusCode).toBe(200);
    const saved = (await viewOf(ctx, id)).application.offerReply!;
    expect(saved.body).toBe('Mein eigener Text, 55.000 €.');
    expect(saved.createdAt).toBe(first.createdAt);
    expect(saved.updatedAt).not.toBe(first.updatedAt);
    const draft = (await ctx.app.inject({ method: 'GET', url: url(id, 'reply-draft'), headers: H })).json() as MailDraft;
    expect(draft.body).toBe('Mein eigener Text, 55.000 €.');
  });

  it('the prompt has no e-mail, phone or street of the profile', async () => {
    const { ctx, id } = await offerPackage();
    await post(ctx, url(id), AMOUNTS);
    const prompt = ctx.provider.calls[0].prompt;
    for (const secret of ['max@example.com', '+49 30', 'Musterstraße', '10115']) expect(prompt).not.toContain(secret);
  });
});
