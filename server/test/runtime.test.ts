import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { findFreePort } from '../src/runtime/port.js';
import { findRunningInstance } from '../src/runtime/instance.js';
import { makeApp } from './helpers/app.js';

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()!(); });

function occupy(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer().once('error', reject).listen(port, '127.0.0.1', () => {
      cleanups.push(() => new Promise<void>((r) => srv.close(() => r())));
      resolve();
    });
  });
}

describe('findFreePort', () => {
  it('skips ports that are already in use', async () => {
    await occupy(45280);
    await occupy(45281);
    expect(await findFreePort('127.0.0.1', 45280, 45285)).toBe(45282);
  });
  it('fails when every port is taken', async () => {
    await occupy(45290);
    await expect(findFreePort('127.0.0.1', 45290, 45290)).rejects.toThrow('NO_FREE_PORT');
  });
});

describe('findRunningInstance', () => {
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bp-inst-'));

  it('returns null without server.json', async () => {
    expect(await findRunningInstance(path.join(tmp(), 'server.json'))).toBeNull();
  });
  it('returns null for a stale file (process gone)', async () => {
    const file = path.join(tmp(), 'server.json');
    fs.writeFileSync(file, JSON.stringify({ port: 45299, pid: 2147483646, startedAt: '' }));
    expect(await findRunningInstance(file)).toBeNull();
  });
  it('finds a live instance', async () => {
    const dir = tmp();
    const port = await findFreePort('127.0.0.1', 45300, 45320);
    const { app } = await makeApp({ allowedHosts: () => [`127.0.0.1:${port}`] });
    await app.listen({ host: '127.0.0.1', port });
    cleanups.push(() => app.close());
    const file = path.join(dir, 'server.json');
    fs.writeFileSync(file, JSON.stringify({ port, pid: process.pid, startedAt: '', key: 'k1' }));
    expect(await findRunningInstance(file)).toEqual({ port, key: 'k1' });
    // A server.json from a pre-0.8.3 server has no key: the caller then opens plain /.
    fs.writeFileSync(file, JSON.stringify({ port, pid: process.pid, startedAt: '' }));
    expect(await findRunningInstance(file)).toEqual({ port, key: '' });
  });
});
