import fs from 'node:fs';
import type { ApplicationView } from '@bp/shared';
import type { Logger } from '../../src/log.js';
import { H, makeApp } from './app.js';
import { makePdf, packageClaude, readyPackageProfile } from './applications.js';
import { vacancy } from './vacancies.js';

export const OFFER = 'Wir suchen einen Webentwickler (m/w/d) für unser Team in Hamburg. '.repeat(12);
export const MAIL = { kind: 'smtp' as const, address: 'max@example.com', senderName: 'Max Mustermann', host: 'smtp.example.com', port: 465, security: 'ssl' as const, user: 'max@example.com', provider: 'other' };
export const MAIL_BODY = { to: 'jobs@muster.example', subject: 'Bewerbung als Webentwickler (m/w/d)', body: 'Sehr geehrte Damen und Herren,\n\nanbei meine Bewerbung.\n\nMax Mustermann' };

export type Ctx = Awaited<ReturnType<typeof makeApp>>;
export const post = (ctx: Ctx, url: string, payload: unknown) => ctx.app.inject({ method: 'POST', url, headers: H, payload: payload as Record<string, unknown> });
export const sendTo = (ctx: Ctx, id: string, payload: unknown = MAIL_BODY) => post(ctx, `/api/applications/${id}/send`, payload);
export const viewOf = async (ctx: Ctx, id: string) => (await ctx.app.inject({ method: 'GET', url: `/api/applications/${id}` })).json() as ApplicationView;

export async function setup(opts: { connected?: boolean; approve?: boolean; logger?: Logger; contact?: boolean; docs?: string[] } = {}) {
  const ctx = await makeApp({ provider: packageClaude(), logger: opts.logger });
  const docIds = (opts.docs ?? []).map((_, i) => `${i + 1}1111111-2222-4333-8444-555555555555`);
  ctx.profileStore.update((p) => {
    Object.assign(p, readyPackageProfile());
    p.documents = (opts.docs ?? []).map((label, i) => ({ id: docIds[i], ext: '.pdf' as const, originalName: `${label}.pdf`, size: 100, uploadedAt: '2026-09-01T10:00:00.000Z', label, attachAlways: true }));
  });
  for (const docId of docIds) fs.writeFileSync(ctx.profileFiles.pathOf({ id: docId, ext: '.pdf' }), await makePdf(1));
  ctx.vacancyStore.add(vacancy({
    id: 'fav1', status: 'favorite', company: 'Muster GmbH', locations: ['Hamburg'],
    ...(opts.contact ? { contact: { email: 'jobs@muster.example', salutation: 'Frau', name: 'Weiler' } } : {}),
  }), OFFER);
  await ctx.app.inject({ method: 'POST', url: '/api/applications', headers: H, payload: { vacancyId: 'fav1', language: 'de' } });
  await ctx.applicationJob.whenIdle();
  const id = ctx.applicationJob.state().applicationId!;
  if (opts.connected !== false) { ctx.settings.setMail(MAIL); await ctx.secrets.save('geheim123'); }
  if (opts.approve !== false) await post(ctx, `/api/applications/${id}/approve`, {});
  return { ctx, id };
}
