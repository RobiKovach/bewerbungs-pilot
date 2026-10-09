import { beforeEach, describe, expect, it } from 'vitest';
import type { MailSettingsView } from '@bp/shared';
import { AppError } from '../src/errors.js';
import type { Logger } from '../src/log.js';
import { H, makeApp } from './helpers/app.js';

const body = (over: Record<string, unknown> = {}) => ({
  address: 'max@example.com', senderName: 'Max Mustermann', host: 'smtp.example.com', port: 465,
  security: 'ssl', user: 'max@example.com', password: 'geheim123', language: 'en', ...over,
});

function put(t: Awaited<ReturnType<typeof makeApp>>, payload: unknown) {
  return t.app.inject({ method: 'PUT', url: '/api/mail/settings', headers: { ...H, host: 'localhost:80' }, payload: payload as object });
}

describe('mail settings API', () => {
  let t: Awaited<ReturnType<typeof makeApp>>;
  const lines: string[] = [];
  const logger: Logger = {
    info: (e, d) => lines.push(JSON.stringify({ e, d })),
    warn: (e, d) => lines.push(JSON.stringify({ e, d })),
    error: (e, d) => lines.push(JSON.stringify({ e, d })),
  };
  beforeEach(async () => { lines.length = 0; t = await makeApp({ logger }); });

  it('GET never returns the password', async () => {
    expect((await put(t, body())).statusCode).toBe(200);
    const res = await t.app.inject({ method: 'GET', url: '/api/mail/settings', headers: { host: 'localhost:80' } });
    expect(res.body).not.toContain('geheim123');
    expect((res.json() as MailSettingsView).passwordSaved).toBe(true);
    expect((res.json() as MailSettingsView).mail?.address).toBe('max@example.com');
  });

  it('GET /api/mail/providers returns the table', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/mail/providers', headers: { host: 'localhost:80' } });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { id: string }[]).map((p) => p.id)).toContain('gmail');
  });

  it('PUT sends a test email to the address and saves only on success', async () => {
    t.mailer.failWith = new AppError('MAIL_AUTH', 'x');
    const bad = await put(t, body());
    expect(bad.statusCode).toBe(502);
    expect(t.settings.get().mail).toBeNull();
    expect(await t.secrets.load()).toBeNull();

    t.mailer.failWith = null;
    const ok = await put(t, body());
    expect(ok.statusCode).toBe(200);
    expect(t.mailer.sent).toHaveLength(1);
    const sent = t.mailer.sent[0]!.mail;
    expect(sent.to).toBe('max@example.com');
    expect(sent.bcc).toBeUndefined();
    expect(sent.from).toEqual({ name: 'Max Mustermann', address: 'max@example.com' });
    expect(sent.subject).toBe('BewerbungsPilot: test email');
    expect(t.settings.get().mail).toMatchObject({ host: 'smtp.example.com' });
    expect(await t.secrets.load()).toBe('geheim123');
  });

  it('PUT without password keeps the saved one; none saved -> MAIL_NOT_CONFIGURED', async () => {
    const noPass: Record<string, unknown> = body();
    delete noPass.password;
    const none = await put(t, noPass);
    expect(none.statusCode).toBe(409);
    expect((none.json() as { error: { code: string } }).error.code).toBe('MAIL_NOT_CONFIGURED');
    expect(t.mailer.sent).toHaveLength(0);

    await put(t, body());
    const again = await put(t, { ...noPass, host: 'smtp.other.example' });
    expect(again.statusCode).toBe(200);
    expect(await t.secrets.load()).toBe('geheim123');
    expect(t.settings.get().mail).toMatchObject({ host: 'smtp.other.example' });
  });

  it('PUT without password never reuses a saved Google refresh token as an SMTP password', async () => {
    t.settings.setMail({ kind: 'google', address: 'max@gmail.com', senderName: 'Max Mustermann', provider: 'gmail' });
    await t.secrets.save('1//refresh-secret');
    const noPass: Record<string, unknown> = body();
    delete noPass.password;
    const res = await put(t, noPass);
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: { code: string } }).error.code).toBe('MAIL_NOT_CONFIGURED');
    expect(t.mailer.sent).toHaveLength(0);
    expect(t.settings.get().mail).toMatchObject({ kind: 'google' });
    expect(await t.secrets.load()).toBe('1//refresh-secret');
  });

  it('CR/LF in any field, or an empty address/user/host -> 400 and no email', async () => {
    const bads: Record<string, unknown>[] = [
      { senderName: 'Max\r\nBcc: x@y.de' }, { address: 'a@b.de\nBcc: x@y.de' }, { host: 'smtp.example.com\r\n' },
      { user: 'max\n' }, { password: 'geheim\r\n123' }, { address: '' }, { user: '' }, { host: '' }, { senderName: '' },
      { port: 0 }, { port: 70000 }, { security: 'none' }, { language: 'xx' }, { address: 'no-at-sign' },
    ];
    for (const over of bads) {
      const res = await put(t, body(over));
      expect(res.statusCode, JSON.stringify(over)).toBe(400);
    }
    expect(t.mailer.sent).toHaveLength(0);
    expect(t.settings.get().mail).toBeNull();
  });

  it('DELETE removes settings and password', async () => {
    await put(t, body());
    const res = await t.app.inject({ method: 'DELETE', url: '/api/mail/settings', headers: { ...H, host: 'localhost:80' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ mail: null, passwordSaved: false });
    expect(t.settings.get().mail).toBeNull();
    expect(await t.secrets.load()).toBeNull();
  });

  it('the log never contains the password', async () => {
    t.mailer.failWith = new AppError('MAIL_AUTH', 'x');
    await put(t, body());
    t.mailer.failWith = null;
    await put(t, body());
    expect(lines.join('\n')).toContain('mail_test');
    expect(lines.join('\n')).not.toContain('geheim123');
    expect(lines.join('\n')).not.toContain('max@example.com');
  });
});
