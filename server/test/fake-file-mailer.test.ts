import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import tls from 'node:tls';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { FakeFileMailer } from '../src/mail/fake-file-mailer.js';
import type { OutgoingMail } from '../src/mail/mailer.js';
import { MailRouter } from '../src/mail/router.js';
import { MAIL } from './helpers/sending.js';

const MAIL_OUT: OutgoingMail = {
  from: { name: 'Max Mustermann', address: 'max@example.com' }, to: 'hr@example.com', bcc: 'max@example.com',
  subject: 'Bewerbung als Webentwickler', text: 'Sehr geehrte Damen und Herren,\n\nanbei meine Bewerbung.',
  attachments: [{ filename: 'Anschreiben.pdf', content: Buffer.alloc(1234) }, { filename: 'Lebenslauf.pdf', content: Buffer.alloc(99) }],
};
const GOOGLE = { kind: 'google' as const, address: 'max@gmail.com', senderName: 'Max Mustermann', provider: 'gmail' as const };

const dirs: string[] = [];
function tmpDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-fake-mail-'));
  dirs.push(d);
  return path.join(d, 'tmp', 'fake-mail');
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const files = (dir: string) => fs.readdirSync(dir).filter((f) => f.endsWith('.json'));

describe('FakeFileMailer (--fake-mail)', () => {
  it('writes exactly one JSON file per mail with attachment names and sizes, never the content', async () => {
    const dir = tmpDir();
    const sent = await new FakeFileMailer(dir).send(MAIL, 'any-password', MAIL_OUT);
    expect(sent.messageId).toBe('fake-1');
    const list = files(dir);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatch(/^\d+-1\.json$/);
    const written = JSON.parse(fs.readFileSync(path.join(dir, list[0]), 'utf8'));
    expect(written).toMatchObject({
      to: 'hr@example.com', cc: null, bcc: 'max@example.com', subject: 'Bewerbung als Webentwickler', text: MAIL_OUT.text,
      attachments: [{ filename: 'Anschreiben.pdf', size: 1234 }, { filename: 'Lebenslauf.pdf', size: 99 }],
    });
    expect(JSON.stringify(written)).not.toContain('any-password');
  });

  it('numbers mails on, also after a restart (new mailer, same folder)', async () => {
    const dir = tmpDir();
    await new FakeFileMailer(dir).send(MAIL, 'x', MAIL_OUT);
    const second = await new FakeFileMailer(dir).send(MAIL, 'x', MAIL_OUT);
    expect(second.messageId).toBe('fake-2');
    expect(files(dir)).toHaveLength(2);
  });

  it('never opens a socket — for SMTP and Google mailboxes alike (both routes of the MailRouter)', async () => {
    const connect = vi.spyOn(net, 'connect');
    const createConnection = vi.spyOn(net, 'createConnection');
    const tlsConnect = vi.spyOn(tls, 'connect');
    const dir = tmpDir();
    const mailer = new FakeFileMailer(dir);
    const router = new MailRouter(mailer, mailer);
    await router.send({ ...MAIL, host: 'smtp.nowhere.invalid' }, 'pw', MAIL_OUT);
    const google = await router.send(GOOGLE, '1//refresh', { ...MAIL_OUT, threadId: 't-1' });
    expect(google.threadId).toBe('t-1');
    expect(files(dir)).toHaveLength(2);
    expect(connect).not.toHaveBeenCalled();
    expect(createConnection).not.toHaveBeenCalled();
    expect(tlsConnect).not.toHaveBeenCalled();
  });
});
