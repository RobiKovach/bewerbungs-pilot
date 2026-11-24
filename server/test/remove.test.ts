import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { removeSync } from '../src/data/remove.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bp remove Дані-'));

describe('removeSync', () => {
  it('removes files, folders, read-only files; a missing path is fine', () => {
    const d = tmp();
    fs.mkdirSync(path.join(d, 'а', 'б'), { recursive: true });
    const ro = path.join(d, 'а', 'б', 'ro.txt');
    fs.writeFileSync(ro, 'x');
    fs.chmodSync(ro, 0o444);
    removeSync(d);
    expect(fs.existsSync(d)).toBe(false);
    removeSync(d);
  });

  it('removes a link to a folder, never what it points to', () => {
    const d = tmp();
    const target = tmp();
    fs.writeFileSync(path.join(target, 'keep.txt'), 'x');
    fs.symlinkSync(target, path.join(d, 'link'), 'junction');
    removeSync(d);
    expect(fs.existsSync(d)).toBe(false);
    expect(fs.existsSync(path.join(target, 'keep.txt'))).toBe(true);
    removeSync(target);
  });

  // fs.rmSync ends the whole process here (Node 24 on Windows).
  it.runIf(process.platform === 'win32')('a folder in use under a path with non-ASCII letters is an ordinary error', async () => {
    const d = tmp();
    const child = spawn(process.execPath, ['-e', 'process.stdout.write("up");setTimeout(()=>{},60000)'], { cwd: d, stdio: ['ignore', 'pipe', 'ignore'] });
    await new Promise((r) => child.stdout.once('data', r));
    try {
      expect(() => removeSync(d, { maxRetries: 2, retryDelay: 20 })).toThrow(/EBUSY|EPERM/);
    } finally {
      const gone = new Promise((r) => child.once('exit', r));
      child.kill();
      await gone;
    }
    removeSync(d, { maxRetries: 20, retryDelay: 100 });
    expect(fs.existsSync(d)).toBe(false);
  });

  it('the app itself uses it everywhere', () => {
    const src = path.resolve(import.meta.dirname, '../src');
    const users = fs.readdirSync(src, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.ts') && f !== path.join('data', 'remove.ts') && /fs\.(rmSync|cpSync)\(/.test(fs.readFileSync(path.join(src, f), 'utf8')));
    expect(users).toEqual([]);
  });
});
