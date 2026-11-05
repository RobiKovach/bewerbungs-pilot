import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { removeTransferLeftovers } from '../src/backup/transfer-routes.js';
import { createFileLogger, type Logger } from '../src/log.js';
import { pkg } from './helpers/applications.js';
import { H, makeApp } from './helpers/app.js';
import { multipartBody } from './helpers/files.js';
import { vacancy } from './helpers/vacancies.js';

type Ctx = Awaited<ReturnType<typeof makeApp>>;
type Opts = NonNullable<Parameters<typeof makeApp>[0]>;

const PASSWORD = 'Geheim-Pass-1234-xyz';

const made: Ctx[] = [];
const roots: string[] = [];
const rmAll = (dir: string) => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bp transfer-'));
  roots.push(root);
  return root;
}
async function start(opts: Opts = {}): Promise<Ctx> {
  const root = tempRoot();
  const ctx = await makeApp({ documents: path.join(root, 'docs'), backupEnv: { USERPROFILE: path.join(root, 'home') }, ...opts });
  made.push(ctx);
  return ctx;
}
afterEach(async () => {
  vi.restoreAllMocks();
  for (const ctx of made.splice(0)) {
    await ctx.app.close();
    rmAll(ctx.dir);
  }
  for (const root of roots.splice(0)) rmAll(root);
});

/** A file logger, so a test reads what really reached the disk. */
function fileLogger(): { logger: Logger; text: () => string } {
  const dir = tempRoot();
  return {
    logger: createFileLogger(dir),
    text: () => fs.readdirSync(dir).map((n) => fs.readFileSync(path.join(dir, n), 'utf8')).join('\n'),
  };
}

const setName = (ctx: Ctx, fullName: string) =>
  ctx.app.inject({ method: 'PUT', url: '/api/profile/sections/personal', headers: H, payload: { data: { ...ctx.profileStore.get().sections.personal.data, fullName } } });
const name = (ctx: Ctx) => ctx.profileStore.get().sections.personal.data.fullName;
const doExport = (ctx: Ctx, password?: string) =>
  ctx.app.inject({ method: 'POST', url: '/api/transfer/export', headers: H, payload: password === undefined ? {} : { password } });
const backupsMade = (ctx: Ctx) => (fs.existsSync(ctx.backupDir) ? fs.readdirSync(ctx.backupDir) : []);
const tmpLeft = (ctx: Ctx) => {
  const tmp = path.join(ctx.dir, 'tmp');
  return fs.existsSync(tmp) ? fs.readdirSync(tmp).filter((n) => n.startsWith('upload-') || n.startsWith('transfer-')) : [];
};
const tmpClean = (ctx: Ctx) => vi.waitFor(() => expect(tmpLeft(ctx)).toEqual([]), { timeout: 5000 });

/** Like the browser's FormData: the field, then the file. */
function upload(filename: string, content: Buffer, field?: { name?: string; value: string; contentType?: string }) {
  const boundary = `----bp${Math.random().toString(16).slice(2)}`;
  const filePart = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`, 'utf8'),
    content, Buffer.from('\r\n', 'utf8'),
  ]);
  const type = field?.contentType ? `Content-Type: ${field.contentType}\r\n` : '';
  const fieldPart = field ? Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${field.name ?? 'password'}"\r\n${type}\r\n${field.value}\r\n`, 'utf8') : Buffer.alloc(0);
  return {
    method: 'POST' as const, url: '/api/backups/restore-upload',
    payload: Buffer.concat([fieldPart, filePart, Buffer.from(`--${boundary}--\r\n`, 'utf8')]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, ...H },
  };
}

function errorOf(res: { statusCode: number; json: () => { error: { code: string; reason?: string } } }) {
  const { error } = res.json();
  return [res.statusCode, error.code, error.reason];
}

describe('transfer API', { timeout: 60_000 }, () => {
  it('export without a password gives a backup that restores', async () => {
    const ctx = await start();
    await setName(ctx, 'Max Mustermann');
    const res = await doExport(ctx);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/zip');
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="BewerbungsPilot-transfer-\d{4}-\d{2}-\d{2}-\d{4}\.zip"$/);
    expect(res.rawPayload.subarray(0, 2).toString('latin1')).toBe('PK');

    await setName(ctx, 'Erika Musterfrau');
    const back = await ctx.app.inject({ method: 'POST', url: '/api/backups/restore-upload', ...multipartBody('file.zip', res.rawPayload) });
    expect(back.statusCode).toBe(200);
    expect(back.json().restored.kind).toBe('manual');
    expect(name(ctx)).toBe('Max Mustermann');
  });

  it('export with a password: name has -encrypted, body starts with BPENC, and restoring with the password brings the profile back', async () => {
    const ctx = await start();
    await setName(ctx, 'Max Mustermann');
    const res = await doExport(ctx, PASSWORD);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="BewerbungsPilot-transfer-\d{4}-\d{2}-\d{2}-\d{4}-encrypted\.zip"$/);
    expect(res.rawPayload.subarray(0, 5).toString('latin1')).toBe('BPENC');
    expect(res.rawPayload.includes('Mustermann')).toBe(false);

    await setName(ctx, 'Erika Musterfrau');
    const back = await ctx.app.inject(upload('x-encrypted.zip', res.rawPayload, { value: PASSWORD }));
    expect(back.statusCode).toBe(200);
    expect(back.json().beforeRestore.kind).toBe('before-restore');
    expect(name(ctx)).toBe('Max Mustermann');
  });

  it('password shorter than 8 → 400 and the password is in neither the answer nor the log', async () => {
    const { logger, text } = fileLogger();
    const ctx = await start({ logger });
    const res = await doExport(ctx, 'abc1234');
    expect(res.statusCode).toBe(400);
    expect(res.body).not.toContain('abc1234');
    expect(text()).toContain('validation_error');
    expect(text()).not.toContain('abc1234');
    expect(tmpLeft(ctx)).toEqual([]);
  });

  it('password over 200 characters → 400; 200 is fine', async () => {
    const ctx = await start();
    expect((await doExport(ctx, 'x'.repeat(201))).statusCode).toBe(400);
    expect((await doExport(ctx, 'x'.repeat(200))).statusCode).toBe(200);
  });

  it('a mistyped key is refused: it must not silently give a file without a password', async () => {
    const ctx = await start();
    const res = await ctx.app.inject({ method: 'POST', url: '/api/transfer/export', headers: H, payload: { passwort: PASSWORD } });
    expect(res.statusCode).toBe(400);
    expect(res.body).not.toContain(PASSWORD);
  });

  it('a malformed body does not echo the password', async () => {
    const { logger, text } = fileLogger();
    const ctx = await start({ logger });
    const res = await ctx.app.inject({ method: 'POST', url: '/api/transfer/export', headers: { ...H, 'content-type': 'application/json' }, payload: `{"password":"${PASSWORD}` });
    expect(res.statusCode).toBe(400);
    expect(res.body).not.toContain(PASSWORD);
    expect(text()).not.toContain(PASSWORD);
  });

  it.each([
    ['wrong password', (raw: Buffer) => raw, 'Falsches-Passwort'],
    ['damaged file', (raw: Buffer) => { const b = Buffer.from(raw); b[b.length - 20] = b[b.length - 20]! ^ 1; return b; }, PASSWORD],
    ['password over 200 characters', (raw: Buffer) => raw, 'x'.repeat(201)],
  ])('upload with a %s: 422 transferCannotOpen, data unchanged, no before-restore backup created', async (_case, change, password) => {
    const ctx = await start();
    await setName(ctx, 'Max Mustermann');
    const { rawPayload } = await doExport(ctx, PASSWORD);
    await setName(ctx, 'Erika Musterfrau');
    const res = await ctx.app.inject(upload('x.zip', change(rawPayload), { value: password }));
    expect(errorOf(res)).toEqual([422, 'BACKUP_INVALID', 'transferCannotOpen']);
    expect(name(ctx)).toBe('Erika Musterfrau');
    expect(backupsMade(ctx)).toEqual([]);
    await tmpClean(ctx);
  });

  it.each([
    ['no field', undefined],
    ['an empty field', { value: '' }],
    ['a non-string JSON field', { value: '{"a":1}', contentType: 'application/json' }],
    ['another field name', { name: 'pass', value: PASSWORD }],
  ] as const)('encrypted upload with %s: 422 transferPasswordNeeded, data unchanged', async (_case, field) => {
    const ctx = await start();
    await setName(ctx, 'Max Mustermann');
    const { rawPayload } = await doExport(ctx, PASSWORD);
    await setName(ctx, 'Erika Musterfrau');
    const res = await ctx.app.inject(upload('x.zip', rawPayload, field));
    expect(errorOf(res)).toEqual([422, 'BACKUP_INVALID', 'transferPasswordNeeded']);
    expect(name(ctx)).toBe('Erika Musterfrau');
    expect(backupsMade(ctx)).toEqual([]);
    await tmpClean(ctx);
  });

  it('a file from a newer format is refused as "newer", data unchanged', async () => {
    const ctx = await start();
    await setName(ctx, 'Max Mustermann');
    const { rawPayload } = await doExport(ctx, PASSWORD);
    rawPayload[5] = 2;
    const res = await ctx.app.inject(upload('x.zip', rawPayload, { value: PASSWORD }));
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('BACKUP_NEWER');
    expect(backupsMade(ctx)).toEqual([]);
    await tmpClean(ctx);
  });

  it('two fields are refused without restoring', async () => {
    const ctx = await start();
    const { rawPayload } = await doExport(ctx);
    const one = upload('x.zip', rawPayload, { value: PASSWORD });
    const boundary = /boundary=(.+)$/.exec(one.headers['content-type'])![1]!;
    const extra = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="other"\r\n\r\nvalue\r\n`, 'utf8');
    const res = await ctx.app.inject({ ...one, payload: Buffer.concat([extra, one.payload]) });
    expect(res.statusCode).toBe(400);
    expect(backupsMade(ctx)).toEqual([]);
  });

  it('plain backup with a stray password restores', async () => {
    const ctx = await start();
    await setName(ctx, 'Max Mustermann');
    const { rawPayload } = await doExport(ctx);
    await setName(ctx, 'Erika Musterfrau');
    const res = await ctx.app.inject(upload('x.zip', rawPayload, { value: PASSWORD }));
    expect(res.statusCode).toBe(200);
    expect(name(ctx)).toBe('Max Mustermann');
  });

  it('the password appears in no log line after export and import, and nowhere in the data folder', async () => {
    const { logger, text } = fileLogger();
    const ctx = await start({ logger });
    await setName(ctx, 'Max Mustermann');
    const { rawPayload } = await doExport(ctx, PASSWORD);
    expect((await ctx.app.inject(upload('x.zip', rawPayload, { value: `${PASSWORD}-wrong` }))).statusCode).toBe(422);
    const ok = await ctx.app.inject(upload('x.zip', rawPayload, { value: PASSWORD }));
    expect(ok.statusCode).toBe(200);
    expect(ok.body).not.toContain(PASSWORD);
    await tmpClean(ctx);

    const log = text();
    expect(log).toContain('transfer_exported');
    expect(log).toContain('backup_restored');
    expect(log).toContain('app_error');
    expect(log).not.toContain(PASSWORD);
    const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
    for (const file of walk(ctx.dir)) expect([file, fs.readFileSync(file).includes(PASSWORD)]).toEqual([file, false]);
  });

  it('tmp holds no upload-*, transfer-* files after success and after failure', async () => {
    const ctx = await start();
    const plain = await doExport(ctx);
    const sealed = await doExport(ctx, PASSWORD);
    await tmpClean(ctx);
    expect((await ctx.app.inject(upload('x.zip', sealed.rawPayload, { value: PASSWORD }))).statusCode).toBe(200);
    await tmpClean(ctx);
    expect((await ctx.app.inject(upload('x.zip', plain.rawPayload))).statusCode).toBe(200);
    await tmpClean(ctx);
    expect((await ctx.app.inject(upload('x.zip', sealed.rawPayload, { value: 'wrong-password' }))).statusCode).toBe(422);
    await tmpClean(ctx);
    expect((await ctx.app.inject(upload('x.zip', Buffer.from('not a zip')))).statusCode).toBe(422);
    await tmpClean(ctx);
  });

  it('the decrypted copy is removed with retries; a failure warns with the code only', async () => {
    const warn = vi.fn();
    const ctx = await start({ logger: { info() {}, error() {}, warn } });
    const { rawPayload } = await doExport(ctx, PASSWORD);
    await tmpClean(ctx);
    const real = fs.promises.rm.bind(fs.promises);
    const rm = vi.spyOn(fs.promises, 'rm').mockImplementation(async (target, opts) => {
      if (/upload-.*-plain\.zip$/.test(String(target))) throw Object.assign(new Error(`locked ${String(target)}`), { code: 'EBUSY' });
      return real(target, opts);
    });
    const res = await ctx.app.inject(upload('x.zip', rawPayload, { value: PASSWORD }));
    expect(res.statusCode).toBe(200); // the restore itself succeeded
    expect(rm).toHaveBeenCalledWith(expect.stringMatching(/-plain\.zip$/), expect.objectContaining({ force: true, maxRetries: 3, retryDelay: 100 }));
    expect(warn).toHaveBeenCalledWith('transfer_upload_cleanup_failed', { code: 'EBUSY' });
  });

  it('a client that aborts the download leaves nothing behind', async () => {
    let host = '';
    const ctx = await start({ allowedHosts: () => [host] });
    // Hard to compress and larger than the socket buffers, so the response cannot finish before the abort.
    fs.writeFileSync(path.join(ctx.filesDir, 'big.bin'), Buffer.alloc(32 * 1024 * 1024).map((_, i) => (i * 2654435761) >>> 13));
    const address = await ctx.app.listen({ port: 0, host: '127.0.0.1' });
    const { hostname, port } = new URL(address);
    host = `${hostname}:${port}`;
    let during: string[] = [];
    let status = 0;
    await new Promise<void>((resolve, reject) => {
      const req = http.request({ hostname, port, path: '/api/transfer/export', method: 'POST', headers: { ...H, 'content-type': 'application/json' } }, (res) => {
        status = res.statusCode ?? 0;
        during = tmpLeft(ctx);
        res.once('data', () => { res.destroy(); resolve(); });
      });
      req.on('error', reject);
      req.end('{}');
    });
    expect(status).toBe(200);
    expect(during).toHaveLength(1);
    await tmpClean(ctx);
  });

  it('Cyrillic password: export and import through the real routes bring the profile back', async () => {
    const ctx = await start();
    await setName(ctx, 'Max Mustermann');
    const cyr = 'пароль-переносу';
    const res = await doExport(ctx, cyr);
    expect(res.statusCode).toBe(200);
    await setName(ctx, 'Erika Musterfrau');
    expect(errorOf(await ctx.app.inject(upload('x-encrypted.zip', res.rawPayload, { value: 'пароль-переносу-не' })))).toEqual([422, 'BACKUP_INVALID', 'transferCannotOpen']);
    expect((await ctx.app.inject(upload('x-encrypted.zip', res.rawPayload, { value: cyr }))).statusCode).toBe(200);
    expect(name(ctx)).toBe('Max Mustermann');
  });

  /** Holds the zipping of the export (createBackup renames its .partial file last) until released. */
  function holdZip() {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const real = fs.promises.rename.bind(fs.promises);
    vi.spyOn(fs.promises, 'rename').mockImplementation(async (from, to) => {
      if (/.zip.partial$/.test(String(from))) await gate;
      return real(from, to);
    });
    return release;
  }

  it('a restore during the zipping of an export refuses and the data stays; export is not left open', async () => {
    const ctx = await start();
    await setName(ctx, 'Max Mustermann');
    const plain = await doExport(ctx);
    await setName(ctx, 'Erika Musterfrau');
    const release = holdZip();
    const running = doExport(ctx);
    await vi.waitFor(() => expect(ctx.activity.active()).toContain('export'));
    const res = await ctx.app.inject(upload('x.zip', plain.rawPayload));
    expect(errorOf(res)).toEqual([409, 'CONFLICT', 'restoreBusyExport']);
    expect(name(ctx)).toBe('Erika Musterfrau');
    release();
    expect((await running).statusCode).toBe(200);
    expect(ctx.activity.active()).not.toContain('export');
    expect((await ctx.app.inject(upload('x.zip', plain.rawPayload))).statusCode).toBe(200);
  });

  it('end() runs when the zipping fails', async () => {
    const ctx = await start();
    const real = fs.promises.rename.bind(fs.promises);
    vi.spyOn(fs.promises, 'rename').mockImplementation(async (from, to) => {
      if (/.zip.partial$/.test(String(from))) throw new Error('disk full');
      return real(from, to);
    });
    const res = await doExport(ctx, PASSWORD);
    expect(errorOf(res)).toEqual([500, 'BACKUP_FAILED', undefined]);
    expect(ctx.activity.active()).toEqual([]);
    await tmpClean(ctx);
  });

  it('a client that leaves before the stream starts (still zipping) leaves nothing behind', async () => {
    let host = '';
    const ctx = await start({ allowedHosts: () => [host] });
    const address = await ctx.app.listen({ port: 0, host: '127.0.0.1' });
    const { hostname, port } = new URL(address);
    host = `${hostname}:${port}`;
    const release = holdZip();
    const req = http.request({ hostname, port, path: '/api/transfer/export', method: 'POST', headers: { ...H, 'content-type': 'application/json' } });
    req.on('error', () => {});
    req.end(JSON.stringify({ password: PASSWORD }));
    await vi.waitFor(() => expect(ctx.activity.active()).toContain('export'));
    expect(tmpLeft(ctx)).toHaveLength(1);
    req.destroy();
    await new Promise((r) => setTimeout(r, 200));
    release();
    await tmpClean(ctx);
    expect(ctx.activity.active()).toEqual([]);
  });

  it('removeTransferLeftovers removes upload-*.zip and transfer-* and leaves other tmp files alone', async () => {
    const tmp = tempRoot();
    fs.writeFileSync(path.join(tmp, 'upload-1.zip'), 'x');
    fs.writeFileSync(path.join(tmp, 'upload-1-plain.zip'), 'x');
    fs.writeFileSync(path.join(tmp, 'upload-1-plain.zip.partial'), 'x'); // the decrypted data of a crashed import
    fs.mkdirSync(path.join(tmp, 'transfer-1'));
    fs.writeFileSync(path.join(tmp, 'transfer-1', 'data.zip'), 'x');
    for (const other of ['upload-1.txt', 'pdf-1', 'restore-1', 'updates', 'keep.zip']) fs.writeFileSync(path.join(tmp, other), 'x');
    await removeTransferLeftovers(tmp);
    expect(fs.readdirSync(tmp).sort()).toEqual(['keep.zip', 'pdf-1', 'restore-1', 'updates', 'upload-1.txt']);
  });

  it('removeTransferLeftovers: no tmp folder yet is fine', async () => {
    const warn = vi.fn();
    await removeTransferLeftovers(path.join(tempRoot(), 'nothing'), warn);
    expect(warn).not.toHaveBeenCalled();
  });

  it('the server clears leftovers when it starts', async () => {
    const ctx = await start({
      beforeBuild: (dir) => {
        fs.mkdirSync(path.join(dir, 'tmp', 'transfer-1'), { recursive: true });
        fs.writeFileSync(path.join(dir, 'tmp', 'upload-1-plain.zip'), 'x');
        fs.writeFileSync(path.join(dir, 'tmp', 'keep.txt'), 'x');
      },
    });
    expect(fs.readdirSync(path.join(ctx.dir, 'tmp'))).toEqual(['keep.txt']);
  });

  it('a failure while clearing leftovers logs and does not stop the start', async () => {
    const warn = vi.fn();
    // `tmp` is a file: listing it fails with something other than "missing".
    const ctx = await start({ logger: { info() {}, error() {}, warn }, beforeBuild: (dir) => fs.writeFileSync(path.join(dir, 'tmp'), 'x') });
    expect(warn).toHaveBeenCalledWith('transfer_leftovers_failed', { code: 'ENOTDIR' });
    expect((await ctx.app.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200);
  });

  it('export during a restore → 409 restoreRunning', async () => {
    const ctx = await start();
    const end = ctx.activity.begin('restore');
    const res = await doExport(ctx, PASSWORD);
    end();
    expect(errorOf(res)).toEqual([409, 'CONFLICT', 'restoreRunning']);
    expect(tmpLeft(ctx)).toEqual([]);
  });

  it('export is not refused during other work', async () => {
    const ctx = await start();
    const end = ctx.activity.begin('send');
    expect((await doExport(ctx)).statusCode).toBe(200);
    end();
  });

  it('export larger than the upload limit → backupTooLarge, so every created file can be opened', async () => {
    const ctx = await start({ maxBackupUploadBytes: 64 });
    for (const password of [undefined, PASSWORD]) {
      const res = await doExport(ctx, password);
      expect(errorOf(res)).toEqual([413, 'FILE_TOO_LARGE', 'backupTooLarge']);
      await tmpClean(ctx);
    }
  });

  it('status: hasData is false on a fresh start, true after a vacancy is added', async () => {
    const ctx = await start();
    const status = async () => (await ctx.app.inject({ method: 'GET', url: '/api/transfer/status', headers: H })).json();
    expect(await status()).toEqual({ hasData: false });
    ctx.settings.patch({ language: 'de' });
    ctx.profileStore.update((p) => { p.wizard.step = 2; });
    expect(await status()).toEqual({ hasData: false }); // only moved through the first steps
    ctx.vacancyStore.add(vacancy({ id: 'v1' }), 'Text');
    expect(await status()).toEqual({ hasData: true });
  });

  it('status: hasData is true for an application or a filled profile alone', async () => {
    const a = await start();
    a.applicationStore.save(pkg({ id: 'app1' }), {});
    expect((await a.app.inject({ method: 'GET', url: '/api/transfer/status', headers: H })).json()).toEqual({ hasData: true });
    const b = await start();
    await setName(b, 'Max Mustermann');
    expect((await b.app.inject({ method: 'GET', url: '/api/transfer/status', headers: H })).json()).toEqual({ hasData: true });
  });
});
