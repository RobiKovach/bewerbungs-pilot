import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { acquireInstanceLock, createShutdown, removeServerInfoIfOwn } from '../src/runtime/lifecycle.js';
import { waitForRunningInstance } from '../src/runtime/instance.js';
import { nullLogger } from '../src/log.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bp-life-'));
const DEAD_PID = 2147483646;

describe('acquireInstanceLock', () => {
  it('lets only one process hold the lock at a time', () => {
    const file = path.join(tmp(), 'server.lock');
    const first = acquireInstanceLock(file);
    expect(first).not.toBeNull();
    expect(fs.readFileSync(file, 'utf8')).toBe(String(process.pid));
    // Another process (here: a live pid that is not ours) holding the lock -> we lose.
    expect(acquireInstanceLock(file)).toBeNull();
    first!.release();
    expect(fs.existsSync(file)).toBe(false);
    const again = acquireInstanceLock(file);
    expect(again).not.toBeNull();
    again!.release();
  });
  it('takes over a lock left behind by a process that no longer exists', () => {
    const file = path.join(tmp(), 'server.lock');
    fs.writeFileSync(file, String(DEAD_PID));
    const lock = acquireInstanceLock(file);
    expect(lock).not.toBeNull();
    expect(fs.readFileSync(file, 'utf8')).toBe(String(process.pid));
    lock!.release();
  });
  it('takes over an empty or garbled lock file (crash while writing it)', () => {
    const file = path.join(tmp(), 'server.lock');
    fs.writeFileSync(file, 'garbage');
    const lock = acquireInstanceLock(file);
    expect(lock).not.toBeNull();
    lock!.release();
  });
});

describe('removeServerInfoIfOwn', () => {
  it('removes server.json only when it belongs to this process', () => {
    const dir = tmp();
    const file = path.join(dir, 'server.json');
    fs.writeFileSync(file, JSON.stringify({ port: 4281, pid: DEAD_PID, startedAt: '' }));
    removeServerInfoIfOwn(file, process.pid);
    expect(fs.existsSync(file)).toBe(true); // a newer instance wrote it - leave it alone
    fs.writeFileSync(file, JSON.stringify({ port: 4281, pid: process.pid, startedAt: '' }));
    removeServerInfoIfOwn(file, process.pid);
    expect(fs.existsSync(file)).toBe(false);
    expect(() => removeServerInfoIfOwn(file, process.pid)).not.toThrow(); // already gone
  });
});

describe('createShutdown', () => {
  it('aborts Claude work first, does not wait forever for close, and cleans up only its own files', async () => {
    const dir = tmp();
    const serverFile = path.join(dir, 'server.json');
    fs.writeFileSync(serverFile, JSON.stringify({ port: 4281, pid: process.pid, startedAt: '' }));
    const order: string[] = [];
    let exitCode: number | null = null;
    const shutdown = createShutdown({
      abortAll: () => order.push('abortAll'),
      close: () => { order.push('close'); return new Promise<void>(() => {}); }, // a request that never finishes
      releaseLock: () => order.push('releaseLock'),
      serverFile,
      closeTimeoutMs: 200,
      logger: nullLogger,
      exit: (code) => { exitCode = code; },
    });
    const started = Date.now();
    await shutdown();
    expect(Date.now() - started).toBeLessThan(2000);
    expect(order).toEqual(['abortAll', 'close', 'releaseLock']);
    expect(exitCode).toBe(0);
    expect(fs.existsSync(serverFile)).toBe(false);
  });
  it('runs only once even when triggered twice', async () => {
    let closes = 0;
    const shutdown = createShutdown({
      abortAll: () => {}, close: async () => { closes++; }, releaseLock: () => {},
      serverFile: path.join(tmp(), 'server.json'), closeTimeoutMs: 200, logger: nullLogger, exit: () => {},
    });
    await Promise.all([shutdown(), shutdown()]);
    expect(closes).toBe(1);
  });
});

describe('waitForRunningInstance', () => {
  it('gives up with null when no instance shows up in time', async () => {
    const started = Date.now();
    expect(await waitForRunningInstance(path.join(tmp(), 'server.json'), 300, 50)).toBeNull();
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
