import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFileLogger } from '../src/log.js';

describe('createFileLogger', () => {
  it('writes JSON lines', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-log-'));
    createFileLogger(dir).info('started', { port: 4280 });
    const line = JSON.parse(fs.readFileSync(path.join(dir, 'app.log'), 'utf8').trim());
    expect(line).toMatchObject({ level: 'info', event: 'started', port: 4280 });
  });
  it('rotates and keeps at most maxFiles files', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-log-'));
    const log = createFileLogger(dir, { maxBytes: 200, maxFiles: 3 });
    for (let i = 0; i < 60; i++) log.info('line', { i });
    expect(fs.readdirSync(dir).sort()).toEqual(['app.1.log', 'app.2.log', 'app.log']);
  });
  it('never throws when the folder cannot be written', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bp-log-')), 'not-a-dir');
    fs.writeFileSync(file, 'x');
    expect(() => createFileLogger(file).error('boom')).not.toThrow();
  });
});
