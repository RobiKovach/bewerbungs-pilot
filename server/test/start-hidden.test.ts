import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { hiddenRunScript, quoteArg, startHidden } from '../src/updates/start-hidden.js';

describe('starting the installer hidden (0.12.1)', () => {
  it('quotes only what needs quoting, by the Windows command-line rules', () => {
    expect(quoteArg('-NoProfile')).toBe('-NoProfile');
    expect(quoteArg('C:\\a\\b.ps1')).toBe('C:\\a\\b.ps1');
    expect(quoteArg('C:\\Users\\Роберт Ко\\[x]\\b.ps1')).toBe('"C:\\Users\\Роберт Ко\\[x]\\b.ps1"');
    expect(quoteArg('C:\\with space\\')).toBe('"C:\\with space\\\\"');
    expect(quoteArg('')).toBe('""');
    expect(quoteArg('a"b')).toBe('"a\\"b"');
  });

  it('the .vbs runs the command hidden (window style 0) and does not wait', () => {
    const vbs = hiddenRunScript('C:\\Windows\\ps.exe', ['-File', 'C:\\my dir\\i.ps1', '-WaitPid', '42']);
    expect(vbs).toContain('CreateObject("WScript.Shell").Run "C:\\Windows\\ps.exe -File ""C:\\my dir\\i.ps1"" -WaitPid 42", 0, False');
    expect(() => hiddenRunScript('x', ['a\nb'])).toThrow();
  });

  it('writes the .vbs as UTF-16 with a BOM next to the release and starts wscript with it', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-hidden-Юля '));
    const calls: { file: string; args: string[]; opts: { detached: boolean; windowsHide: boolean; cwd: string } }[] = [];
    const child = Object.assign(new EventEmitter(), { unref: () => undefined, kill: () => true });
    const started = startHidden('C:\\ps.exe', ['-File', path.join(dir, 'i.ps1')], { cwd: dir, env: {} }, {
      wscript: 'C:\\Windows\\System32\\wscript.exe',
      spawn: ((file: string, args: string[], opts: { detached: boolean; windowsHide: boolean; cwd: string }) => {
        calls.push({ file, args, opts });
        setImmediate(() => child.emit('spawn'));
        return child;
      }) as never,
    });
    await expect(started).resolves.toHaveProperty('kill');
    const vbs = path.join(dir, 'start-installer.vbs');
    expect(calls).toEqual([{ file: 'C:\\Windows\\System32\\wscript.exe', args: ['//B', '//NoLogo', vbs], opts: expect.objectContaining({ detached: true, windowsHide: true, cwd: dir }) }]);
    const raw = fs.readFileSync(vbs);
    expect([raw[0], raw[1]]).toEqual([0xff, 0xfe]);
    expect(raw.subarray(2).toString('utf16le')).toContain(`"C:\\ps.exe -File ""${path.join(dir, 'i.ps1')}"""`);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('a starter that cannot start rejects (the app then says the installer did not start)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-hidden-'));
    const child = Object.assign(new EventEmitter(), { unref: () => undefined, kill: () => true });
    const started = startHidden('C:\\ps.exe', [], { cwd: dir, env: {} }, { spawn: (() => { setImmediate(() => child.emit('error', new Error('ENOENT'))); return child; }) as never });
    await expect(started).rejects.toThrow('ENOENT');
    await expect(startHidden('C:\\ps.exe', [], { cwd: path.join(dir, 'missing'), env: {} })).rejects.toThrow();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // The real thing, because the mocked spawn in update-apply.test.ts could not catch it: a detached Windows PowerShell
  // exited without running the installer at all. This starts real PowerShell the way the app does and waits for the
  // script's file, from a folder with a space, Cyrillic letters and brackets (user names do have them).
  it.runIf(process.platform === 'win32')('really runs a PowerShell script to its end (Windows)', { timeout: 60_000 }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-hidden-Роберт [1] '));
    const script = path.join(dir, 'probe.ps1');
    const out = path.join(dir, 'ran.txt');
    fs.writeFileSync(script, '\ufeffparam([string]$Out, [int]$WaitPid)\r\nStart-Sleep -Milliseconds 500\r\n[IO.File]::WriteAllText($Out, "ran $WaitPid")\r\n', 'utf8');
    const ps = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    await startHidden(ps, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Out', out, '-WaitPid', '7'], { cwd: dir, env: process.env });
    const t0 = Date.now();
    while (!fs.existsSync(out) && Date.now() - t0 < 45_000) await new Promise((r) => setTimeout(r, 200));
    expect(fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : 'the script never ran').toBe('ran 7');
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });
});
