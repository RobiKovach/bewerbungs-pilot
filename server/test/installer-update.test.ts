import { describe, it, expect } from 'vitest';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nullLogger } from '../src/log.js';
import { readUpdateOutcome } from '../src/updates/apply.js';

const INSTALLER = fileURLToPath(new URL('../../installer/install.ps1', import.meta.url));
const windows = process.platform === 'win32';

// Spaces + Cyrillic on purpose, like the other installer tests.
const tempRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bp оновлення-'));
const psString = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** Dot-sources the installer (which only loads its functions) and runs `script` after it. */
function ps(script: string): string {
  const quoted = INSTALLER.replace(/'/g, "''");
  return execFileSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
    `[Console]::OutputEncoding = [Text.Encoding]::UTF8; . '${quoted}'; ${script}`,
  ], { encoding: 'utf8', windowsHide: true, timeout: 90_000 });
}

interface Fixture { root: string; app: string; previous: string; release: string; data: string; status: string; backups: string; log: string }

function put(file: string, text: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function fixture(dirName = 'bp оновлення-'): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), dirName));
  const app = path.join(root, 'Programs', 'BewerbungsPilot');
  const release = path.join(root, 'extracted', 'release');
  const data = path.join(root, 'BewerbungsPilot');
  put(path.join(app, 'package.json'), '{"version":"1.0.0"}');
  put(path.join(app, 'old.txt'), 'old');
  put(path.join(app, 'installer', 'launch.vbs'), "' old launcher");
  put(path.join(app, 'server', 'dist', 'index.js'), '// old');
  put(path.join(release, 'package.json'), '{"version":"2.0.0"}');
  put(path.join(release, 'new.txt'), 'new');
  put(path.join(release, 'installer', 'launch.vbs'), "' new launcher");
  put(path.join(release, 'server', 'dist', 'index.js'), '// new');
  put(path.join(data, 'settings.json'), '{"schemaVersion":2}');
  put(path.join(data, 'profile', 'profile.json'), '{"name":"Max"}');
  return { root, app, previous: `${app}.previous`, release, data, status: path.join(data, 'update-status.json'), backups: path.join(root, 'Backups'), log: path.join(root, 'fake.log') };
}

interface RunOptions {
  node?: boolean | string; // false: node lookup finds nothing; a string: that real node.exe (its NODE_OPTIONS are logged)
  npmExit?: number;
  probe?: string | null;   // version the health probe reports for the new app (null = no answer)
  backupDir?: string;
  waitPid?: number;
  waitSec?: number;
  noReadHost?: boolean;
  prelude?: string;        // extra PowerShell run before the update (e.g. to hold a file open)
  findNodeThrows?: boolean;
}

function runUpdate(fx: Fixture, o: RunOptions = {}) {
  const node = o.node === false ? '$null' : typeof o.node === 'string' ? psString(o.node) : `'C:\\fake\\node.exe'`;
  const logOptions = typeof o.node === 'string' ? ` Add-Content -Encoding UTF8 -LiteralPath $log -Value ("npm NODE_OPTIONS=" + $env:NODE_OPTIONS);` : '';
  const probe = o.probe === null ? '$null' : `'${o.probe ?? '2.0.0'}'`;
  const script = [
    o.noReadHost === false ? '' : `function Read-Host { throw 'Read-Host must not be called in unattended mode' };`,
    o.prelude ?? '',
    `$log = ${psString(fx.log)};`,
    `$findNode = { ${o.findNodeThrows ? "throw 'boom'" : node} };`,
    // The fake npm records what the world looked like while the new app was being installed.
    `$npm = { param($dir) $st = Get-Content -Raw -LiteralPath ${psString(fx.status)} | ConvertFrom-Json; ` +
      `Add-Content -Encoding UTF8 -LiteralPath $log -Value ("npm dir=" + $dir + " previous=" + (Test-Path -LiteralPath ${psString(fx.previous)}) + " state=" + $st.state + " step=" + $st.step);${logOptions} ${o.npmExit ?? 0} };`,
    // Starting the new app makes it "write" server.json; starting the old one (rollback) does not.
    `$start = { param($dir) $v = (Get-Content -Raw -LiteralPath (Join-Path $dir 'package.json') | ConvertFrom-Json).version; ` +
      `Add-Content -Encoding UTF8 -LiteralPath $log -Value ("start " + $v); ` +
      `if ($v -eq '2.0.0') { [IO.File]::WriteAllText((Join-Path ${psString(fx.data)} 'server.json'), '{"port":45678,"pid":0,"startedAt":"x","key":"k"}') } };`,
    `$probe = { param($port) ${probe} };`,
    `$code = @(Invoke-BpUnattendedUpdate -AppDir ${psString(fx.app)} -DataDir ${psString(fx.data)} -ReleaseRoot ${psString(fx.release)} ` +
      `-StatusFile ${psString(fx.status)} -WaitPid ${o.waitPid ?? 0} -WaitSec ${o.waitSec ?? 2} -HealthTimeoutSec 2 -PollMs 100 ` +
      `-BackupDir ${psString(o.backupDir ?? fx.backups)} -FindNode $findNode -RunNpmCi $npm -StartApp $start -ProbeHealth $probe ` +
      `-CreateShortcuts { Add-Content -Encoding UTF8 -LiteralPath $log -Value 'shortcuts' })[-1]; "EXIT=$code"`,
  ].join(' ');
  const out = ps(script);
  const code = Number(/EXIT=(\d+)/.exec(out)?.[1]);
  const status = fs.existsSync(fx.status) ? JSON.parse(fs.readFileSync(fx.status, 'utf8')) : null;
  const log = fs.existsSync(fx.log) ? fs.readFileSync(fx.log, 'utf8').replace(/^\uFEFF/, '').trim().split(/\r?\n/) : [];
  return { out, code, status, log };
}

describe.skipIf(!windows)('installer unattended update (PowerShell)', () => {
  it('does not run the update when dot-sourced and has the unattended switches', () => {
    const text = fs.readFileSync(INSTALLER, 'utf8');
    expect(text).toMatch(/\[switch\]\$Unattended/);
    expect(text).toMatch(/\$StatusFile/);
    expect(text).toMatch(/\$WaitPid/);
  });

  it('success: renames the old app aside, installs, waits for the new version, removes .previous, reports done', () => {
    const fx = fixture();
    const r = runUpdate(fx);
    expect(r.code).toBe(0);
    expect(r.status).toMatchObject({ state: 'done', step: 'starting', from: '1.0.0', to: '2.0.0' });
    expect(r.status.at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(r.status.error).toBeUndefined();
    expect(fs.existsSync(path.join(fx.app, 'new.txt'))).toBe(true);
    expect(fs.existsSync(path.join(fx.app, 'old.txt'))).toBe(false);
    expect(fs.existsSync(fx.previous)).toBe(false);
    expect(fs.readFileSync(path.join(fx.app, 'installer', 'node-path.txt'), 'utf16le').replace(/^\uFEFF/, '').trim()).toBe('C:\\fake\\node.exe');
    // A node that cannot be asked (here: not there) gets no --use-system-ca.
    expect(fs.existsSync(path.join(fx.app, 'installer', 'node-options.txt'))).toBe(false);
    // While npm ran the old app was still on disk as .previous, and the status said "running / installing".
    expect(r.log[0]).toBe(`npm dir=${fx.app} previous=True state=running step=installing`);
    expect(r.log).toContain('shortcuts');
    expect(r.log).toContain('start 2.0.0');
    // The data backup was made and the data itself is untouched.
    expect(fs.readdirSync(fx.backups).filter((n) => n.endsWith('.zip'))).toHaveLength(1);
    expect(fs.readFileSync(path.join(fx.data, 'profile', 'profile.json'), 'utf8')).toBe('{"name":"Max"}');
    // The status file is plain UTF-8 without BOM (Node's JSON.parse chokes on a BOM) and leaves no .tmp behind.
    const bytes = fs.readFileSync(fx.status);
    expect(bytes[0]).toBe(0x7b);
    expect(fs.existsSync(`${fx.status}.tmp`)).toBe(false);
  }, 90_000);

  // 0.12.3: a tester's antivirus HTTPS scanning made npm fail with SELF_SIGNED_CERT_IN_CHAIN. A node that accepts
  // --use-system-ca (this test's own node) gets it for npm, and launch.vbs is told through node-options.txt.
  it('a node that can use the Windows certificate store gets --use-system-ca for npm and the app', () => {
    const fx = fixture();
    const r = runUpdate(fx, { node: process.execPath });
    expect(r.code).toBe(0);
    expect(r.log).toContain('npm NODE_OPTIONS=--use-system-ca');
    expect(fs.readFileSync(path.join(fx.app, 'installer', 'node-options.txt'), 'utf16le').replace(/^\uFEFF/, '').trim()).toBe('--use-system-ca');
  }, 90_000);

  it('never asks anything: missing Node is a failure, nothing is touched', () => {
    const fx = fixture();
    const r = runUpdate(fx, { node: false });
    expect(r.code).toBe(1);
    expect(r.status).toMatchObject({ state: 'failed', from: '1.0.0', to: '2.0.0' });
    expect(r.status.error).toMatch(/node/i);
    expect(fs.existsSync(path.join(fx.app, 'old.txt'))).toBe(true);
    expect(fs.existsSync(fx.previous)).toBe(false);
    expect(r.log).toEqual(["start 1.0.0"]);
  }, 90_000);

  it('a failed backup stops the update (state failed, step backup) and leaves the app folder untouched', () => {
    const fx = fixture();
    const notAFolder = path.join(fx.root, 'a file');
    fs.writeFileSync(notAFolder, 'x');
    const r = runUpdate(fx, { backupDir: notAFolder });
    expect(r.code).toBe(1);
    expect(r.status).toMatchObject({ state: 'failed', step: 'backup' });
    expect(fs.existsSync(path.join(fx.app, 'old.txt'))).toBe(true);
    expect(fs.existsSync(path.join(fx.app, 'new.txt'))).toBe(false);
    expect(fs.existsSync(fx.previous)).toBe(false);
    expect(r.log).toEqual(["start 1.0.0"]);
  }, 90_000);

  it('npm ci failing rolls back: old app back in place, started again, state rolledBack with the reason', () => {
    const fx = fixture();
    const r = runUpdate(fx, { npmExit: 1 });
    expect(r.code).toBe(2);
    expect(r.status).toMatchObject({ state: 'rolledBack', step: 'installing', from: '1.0.0', to: '2.0.0' });
    expect(r.status.error).toMatch(/npm ci/);
    expect(fs.existsSync(path.join(fx.app, 'old.txt'))).toBe(true);
    expect(fs.existsSync(path.join(fx.app, 'new.txt'))).toBe(false);
    expect(fs.existsSync(fx.previous)).toBe(false);
    expect(r.log.at(-1)).toBe('start 1.0.0');
  }, 90_000);

  it.each([
    ['no answer from the new server', null],
    ['the old version still answering', '1.0.0'],
  ])('rolls back when there is %s', (_name, probe) => {
    const fx = fixture();
    const r = runUpdate(fx, { probe });
    expect(r.code).toBe(2);
    expect(r.status).toMatchObject({ state: 'rolledBack', step: 'starting' });
    expect(r.status.error).toMatch(/health|answer|version/i);
    expect(fs.existsSync(path.join(fx.app, 'old.txt'))).toBe(true);
    expect(fs.existsSync(path.join(fx.app, 'new.txt'))).toBe(false);
    expect(fs.existsSync(fx.previous)).toBe(false);
    expect(r.log.slice(-2)).toEqual(['start 2.0.0', 'start 1.0.0']);
  }, 90_000);

  it('leftover .previous with no app folder is renamed back first, then the update runs normally', () => {
    const fx = fixture();
    fs.renameSync(fx.app, fx.previous);
    const r = runUpdate(fx);
    expect(r.code).toBe(0);
    expect(r.status).toMatchObject({ state: 'done', from: '1.0.0', to: '2.0.0' });
    expect(fs.existsSync(path.join(fx.app, 'new.txt'))).toBe(true);
    expect(fs.existsSync(fx.previous)).toBe(false);
  }, 90_000);

  it('leftover .previous next to an app folder is removed', () => {
    const fx = fixture();
    put(path.join(fx.previous, 'stale.txt'), 'stale');
    const r = runUpdate(fx);
    expect(r.code).toBe(0);
    expect(fs.existsSync(fx.previous)).toBe(false);
    expect(r.log[0]).toContain('previous=True'); // the NEW .previous, made from the real old app
  }, 90_000);

  it('-WaitPid: continues once that process has exited', async () => {
    const fx = fixture();
    const child = spawn('powershell.exe', ['-NoProfile', '-Command', 'Start-Sleep 1'], { windowsHide: true });
    const started = Date.now();
    const r = runUpdate(fx, { waitPid: child.pid!, waitSec: 20 });
    expect(r.code).toBe(0);
    expect(r.status.state).toBe('done');
    expect(Date.now() - started).toBeLessThan(80_000);
  }, 90_000);

  it('-WaitPid: a process that never exits and is not node makes the update fail at "stopping" without touching anything', () => {
    const fx = fixture();
    const child = spawn('powershell.exe', ['-NoProfile', '-Command', 'Start-Sleep 60'], { windowsHide: true });
    try {
      const r = runUpdate(fx, { waitPid: child.pid!, waitSec: 1 });
      expect(r.code).toBe(1);
      expect(r.status).toMatchObject({ state: 'failed', step: 'stopping' });
      expect(fs.existsSync(path.join(fx.app, 'old.txt'))).toBe(true);
      expect(fs.existsSync(fx.previous)).toBe(false);
      expect(fs.existsSync(fx.backups)).toBe(false);
      expect(r.log).toEqual([]);
    } finally {
      child.kill();
    }
  }, 90_000);

  it('-WaitPid: a node process that does not exit in time is stopped, then the update continues', () => {
    const fx = fixture();
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { windowsHide: true });
    try {
      const r = runUpdate(fx, { waitPid: child.pid!, waitSec: 1 });
      expect(r.code).toBe(0);
      expect(r.status.state).toBe('done');
    } finally {
      child.kill();
    }
  }, 90_000);

  it('an unexpected exception still ends in a final state (failed) and starts the old app again', () => {
    const fx = fixture();
    const r = runUpdate(fx, { findNodeThrows: true });
    expect(r.code).toBe(1);
    expect(r.status.state).toBe('failed');
    expect(r.status.error).toMatch(/^unexpected: .*boom/);
    expect(r.log).toEqual(['start 1.0.0']);
    expect(fs.existsSync(path.join(fx.app, 'old.txt'))).toBe(true);
  }, 90_000);

  it('Write-BpStatus tries again when the file is briefly locked', () => {
    const dir = tempRoot();
    const file = path.join(dir, 'status.json');
    fs.writeFileSync(file, '{}');
    ps(`$global:lk = [IO.File]::Open(${psString(file)}, 'Open', 'Read', 'None'); ` +
      `function Start-Sleep { param($Milliseconds) if ($global:lk) { $global:lk.Dispose(); $global:lk = $null } }; ` +
      `Write-BpStatus -File ${psString(file)} -State done -Step starting -From 1.0.0 -To 2.0.0`);
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toMatchObject({ state: 'done' });
  }, 60_000);

  it('moving the old app aside tries again when a file in it is briefly held', () => {
    const fx = fixture();
    const r = runUpdate(fx, {
      prelude: `$global:lk = [IO.File]::Open(${psString(path.join(fx.app, 'old.txt'))}, 'Open', 'Read', 'None'); ` +
        `function Start-Sleep { param($Milliseconds) Add-Content -LiteralPath $log -Value 'slept'; if ($global:lk) { $global:lk.Dispose(); $global:lk = $null } };`,
    });
    expect(r.code).toBe(0);
    expect(r.log).toContain('slept');
    expect(fs.existsSync(path.join(fx.app, 'new.txt'))).toBe(true);
  }, 90_000);

  it('works in a folder whose name contains [ ] (literal paths everywhere)', () => {
    const fx = fixture('bp [x] оновлення-');
    const r = runUpdate(fx);
    expect(r.code).toBe(0);
    expect(r.status.state).toBe('done');
    expect(fs.existsSync(path.join(fx.app, 'new.txt'))).toBe(true);
    expect(fs.existsSync(path.join(fx.app, 'installer', 'node-path.txt'))).toBe(true);
  }, 90_000);

  describe('leftover .previous next to a broken app folder is resolved by the last status', () => {
    const prepare = (status: object | null) => {
      const fx = fixture();
      fs.renameSync(fx.app, fx.previous); // the good old app
      put(path.join(fx.app, 'junk.txt'), 'half-copied'); // the broken new one: no package.json
      if (status) put(fx.status, JSON.stringify(status));
      return fx;
    };
    it.each([
      ['running installing', { state: 'running', step: 'installing' }],
      ['running starting', { state: 'running', step: 'starting' }],
      ['failed after a failed rollback', { state: 'failed', step: 'installing', error: 'rollback failed: busy (update problem: x)' }],
    ])('restores .previous when the status is %s', (_n, status) => {
      const fx = prepare(status);
      const r = runUpdate(fx);
      expect(r.code).toBe(0);
      expect(r.status).toMatchObject({ state: 'done', from: '1.0.0' }); // 1.0.0 = read from the restored copy
      expect(fs.existsSync(path.join(fx.app, 'junk.txt'))).toBe(false);
      expect(fs.existsSync(path.join(fx.app, 'new.txt'))).toBe(true);
      expect(fs.existsSync(fx.previous)).toBe(false);
    }, 90_000);

    it.each([
      ['done', { state: 'done', step: 'starting' }],
      ['no status file', null],
    ])('removes .previous when the status is %s', (_n, status) => {
      const fx = prepare(status);
      const r = runUpdate(fx);
      expect(r.code).toBe(0);
      expect(r.status.from).toBe('0.0.0'); // the app folder (junk) was kept, .previous deleted
      expect(fs.existsSync(fx.previous)).toBe(false);
    }, 90_000);
  });

  it('the leftover .previous is resolved after the old app was stopped, not before', () => {
    const fx = fixture();
    fs.renameSync(fx.app, fx.previous);
    put(path.join(fx.app, 'junk.txt'), 'half-copied');
    put(fx.status, JSON.stringify({ state: 'running', step: 'installing' }));
    const r = runUpdate(fx, {
      prelude: `function Stop-BpOldApp { Add-Content -Encoding UTF8 -LiteralPath $log -Value 'stopped'; return $true }; ` +
        `function Invoke-BpRetry { param($Tries, $DelayMs, $Action) if ($Action.ToString() -match 'Remove-Item') { Add-Content -Encoding UTF8 -LiteralPath $log -Value 'cleanup' }; & $Action }; `,
    });
    expect(r.code).toBe(0);
    expect(r.log.filter((l) => l === 'stopped' || l === 'cleanup')).toEqual(['stopped', 'cleanup']);
  }, 90_000);

  describe('Write-BpStatus and readUpdateOutcome agree on the file', () => {
    const outcome = (state: string, err: string | null) => {
      const dir = tempRoot();
      const file = path.join(dir, 'update-status.json');
      const errArg = err === null ? '$null' : psString(err);
      ps(`Write-BpStatus -File ${psString(file)} -State ${psString(state)} -Step 'starting' -From '0.10.1' -To '0.11.0' -Err ${errArg}`);
      const o = readUpdateOutcome(file, nullLogger);
      const result = o.take();
      return { result, exists: fs.existsSync(file) };
    };
    it('done → justUpdated, file consumed', () => {
      expect(outcome('done', null)).toEqual({ result: { justUpdated: '0.11.0' }, exists: false });
    });
    it('rolledBack and failed → failed', () => {
      expect(outcome('rolledBack', 'new version did not answer').result).toEqual({ lastUpdateError: 'failed' });
      expect(outcome('failed', 'backup failed').result).toEqual({ lastUpdateError: 'failed' });
    });
    it('"rollback failed: …" → rollbackFailed', () => {
      expect(outcome('failed', 'rollback failed: copy').result).toEqual({ lastUpdateError: 'rollbackFailed' });
    });
    it('running (fresh) → updatePending, file kept', () => {
      expect(outcome('running', null)).toEqual({ result: { updatePending: true }, exists: true });
    });
  });

  it('Write-BpStatus replaces an existing file atomically as UTF-8 without BOM', () => {
    const dir = tempRoot();
    const file = path.join(dir, 'status.json');
    ps(`Write-BpStatus -File ${psString(file)} -State running -Step stopping -From 1.0.0 -To 2.0.0; ` +
      `Write-BpStatus -File ${psString(file)} -State failed -Step backup -From 1.0.0 -To 2.0.0 -Err 'Ольга: boom'`);
    const bytes = fs.readFileSync(file);
    expect(bytes[0]).toBe(0x7b);
    expect(JSON.parse(bytes.toString('utf8'))).toMatchObject({ state: 'failed', step: 'backup', from: '1.0.0', to: '2.0.0', error: 'Ольга: boom' });
    expect(fs.readdirSync(dir)).toEqual(['status.json']);
  }, 60_000);

  it('Get-BpHealthVersion reads the version from /api/health and gives $null when nothing answers', async () => {
    const server = http.createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(req.url === '/api/health' ? '{"ok":true,"app":"bewerbungs-pilot","version":"2.0.0","demo":false}' : '{}');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    try {
      const out = await new Promise<string>((resolve, reject) => {
        const quoted = INSTALLER.replace(/'/g, "''");
        const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
          `. '${quoted}'; Get-BpHealthVersion ${port}; if ($null -eq (Get-BpHealthVersion 1)) { 'null' }`], { windowsHide: true });
        let text = '';
        child.stdout.on('data', (d) => { text += d; });
        child.on('error', reject);
        child.on('close', () => resolve(text));
      });
      expect(out.trim().split(/\r?\n/)).toEqual(['2.0.0', 'null']);
    } finally {
      server.close();
    }
  }, 60_000);
});
