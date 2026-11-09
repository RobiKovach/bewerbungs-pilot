import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const LAUNCH_VBS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../installer/launch.vbs');
const windows = process.platform === 'win32';

/**
 * Runs the real installer/launch.vbs from a fake app folder whose "server" only writes down the NODE_OPTIONS it got.
 * No starting.html in the fake folder, so no browser tab is opened.
 */
async function launch(opts: { optionsFile?: string; userOptions?: string }): Promise<string> {
  const app = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-launch Ю '));
  fs.mkdirSync(path.join(app, 'installer'));
  fs.mkdirSync(path.join(app, 'server', 'dist'), { recursive: true });
  fs.copyFileSync(LAUNCH_VBS, path.join(app, 'installer', 'launch.vbs'));
  const utf16 = (s: string) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(s, 'utf16le')]);
  fs.writeFileSync(path.join(app, 'installer', 'node-path.txt'), utf16(process.execPath));
  if (opts.optionsFile !== undefined) fs.writeFileSync(path.join(app, 'installer', 'node-options.txt'), utf16(opts.optionsFile));
  const out = path.join(app, 'seen.txt');
  fs.writeFileSync(path.join(app, 'server', 'dist', 'index.js'),
    `require('fs').writeFileSync(${JSON.stringify(out)}, 'NODE_OPTIONS=' + (process.env.NODE_OPTIONS ?? '<none>'));\n`);
  const env: NodeJS.ProcessEnv = { ...process.env, BP_DATA_DIR: path.join(app, 'data') };
  delete env.NODE_OPTIONS;
  if (opts.userOptions !== undefined) env.NODE_OPTIONS = opts.userOptions;
  execFileSync(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'wscript.exe'), ['//B', path.join(app, 'installer', 'launch.vbs')], { env });
  const t0 = Date.now();
  while (!fs.existsSync(out) && Date.now() - t0 < 20_000) await new Promise((r) => setTimeout(r, 100));
  const seen = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : 'the server never started';
  fs.rmSync(app, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  return seen;
}

describe.skipIf(!windows)('launch.vbs and --use-system-ca (0.12.3)', { timeout: 60_000 }, () => {
  it('starts the server with --use-system-ca when the installer wrote node-options.txt', async () => {
    expect(await launch({ optionsFile: '--use-system-ca' })).toBe('NODE_OPTIONS=--use-system-ca');
  });

  it('keeps the person\'s own NODE_OPTIONS and adds the flag only once', async () => {
    expect(await launch({ optionsFile: '--use-system-ca', userOptions: '--max-old-space-size=512' })).toBe('NODE_OPTIONS=--max-old-space-size=512 --use-system-ca');
    expect(await launch({ optionsFile: '--use-system-ca', userOptions: '--use-system-ca' })).toBe('NODE_OPTIONS=--use-system-ca');
  });

  it('without the file, or with anything else in it, nothing is added', async () => {
    expect(await launch({})).toBe('NODE_OPTIONS=<none>');
    expect(await launch({ optionsFile: '--require C:\\evil.js' })).toBe('NODE_OPTIONS=<none>');
  });
});
