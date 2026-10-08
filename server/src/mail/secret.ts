import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';

export interface SecretStore {
  save(secret: string): Promise<void>;
  load(): Promise<string | null>;
  remove(): Promise<void>;
}

export class MemorySecretStore implements SecretStore {
  private value: string | null = null;
  async save(secret: string): Promise<void> { this.value = secret; }
  async load(): Promise<string | null> { return this.value; }
  async remove(): Promise<void> { this.value = null; }
}

const ENCRYPT = "$s=[Console]::In.ReadToEnd(); Add-Type -AssemblyName System.Security; $b=[Text.Encoding]::UTF8.GetBytes($s); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($b,$null,'CurrentUser'))";
const DECRYPT = "try { $s=[Console]::In.ReadToEnd().Trim(); Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String($s); $p=[Security.Cryptography.ProtectedData]::Unprotect($b,$null,'CurrentUser'); $o=[Console]::OpenStandardOutput(); $o.Write($p,0,$p.Length); $o.Flush() } catch { exit 1 }";
const TIMEOUT_MS = 15_000;

// Runs a fixed PowerShell script; the input goes through stdin only (never the command line).
// Errors carry no input and no stderr (it could echo the input).
function runPowerShell(script: string, input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    let settled = false;
    const timer = setTimeout(() => { child.kill(); done(new Error('powershell timed out')); }, TIMEOUT_MS);
    function done(err: Error | null, value = ''): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err); else resolve(value);
    }
    child.stdout.on('data', (d: Buffer) => out.push(d));
    child.stderr.on('data', () => {});
    child.on('error', () => done(new Error('powershell failed to start')));
    child.on('close', (code) => (code === 0 ? done(null, Buffer.concat(out).toString('utf8')) : done(new Error(`powershell exited with code ${code}`))));
    child.stdin.on('error', () => {});
    child.stdin.end(input, 'utf8');
  });
}

// Windows DPAPI (current user): the file is useless on another PC or account.
export class DpapiSecretStore implements SecretStore {
  constructor(private readonly file: string) {}

  async save(secret: string): Promise<void> {
    const base64 = (await runPowerShell(ENCRYPT, secret)).trim();
    if (!base64) throw new Error('encryption returned nothing');
    const tmp = `${this.file}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    fs.writeFileSync(tmp, base64, 'utf8');
    try {
      fs.renameSync(tmp, this.file);
    } catch (err) {
      fs.rmSync(tmp, { force: true });
      throw err;
    }
  }

  async load(): Promise<string | null> {
    let base64: string;
    try {
      base64 = fs.readFileSync(this.file, 'utf8');
    } catch {
      return null;
    }
    try {
      return (await runPowerShell(DECRYPT, base64)) || null;
    } catch {
      return null;
    }
  }

  async remove(): Promise<void> {
    fs.rmSync(this.file, { force: true });
  }
}
