import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Starts a console program (the PowerShell installer) hidden and independent of this server (0.12.1).
 *
 * Found at the first real "Update now" (0.11.0 → 0.12.0): Node's `detached: true` starts the child without any console
 * (DETACHED_PROCESS), and Windows PowerShell then exits at once without running the script (exit code 0, ~0.1 s).
 * Without `detached` the script runs, but it shares the server's hidden console and dies when the server quits — which
 * it must, so the installer can replace the program. What works is what the desktop shortcut already does
 * (installer/launch.vbs): wscript.exe — a windowless program, fine without a console — runs the command with
 * WScript.Shell.Run(…, 0, False), which gives it its own hidden console that outlives us.
 *
 * The command line goes into a small .vbs file next to the unpacked release; it is written as UTF-16 with a BOM, the
 * only encoding wscript reads that keeps non-Latin letters in a user name.
 */

/** One argument for the Windows command line (CommandLineToArgvW rules). Paths never contain `"`. */
export function quoteArg(arg: string): string {
  if (arg !== '' && !/[\s"]/.test(arg)) return arg;
  let out = '"';
  let slashes = 0;
  for (const ch of arg) {
    if (ch === '\\') { slashes++; continue; }
    if (ch === '"') { out += '\\'.repeat(slashes * 2 + 1) + '"'; slashes = 0; continue; }
    out += '\\'.repeat(slashes) + ch;
    slashes = 0;
  }
  return `${out}${'\\'.repeat(slashes * 2)}"`;
}

/** The whole .vbs: runs `file args…` with a hidden window and does not wait. */
export function hiddenRunScript(file: string, args: string[]): string {
  const commandLine = [file, ...args].map(quoteArg).join(' ');
  if (/[\r\n]/.test(commandLine)) throw new Error('a line break in the installer command');
  const literal = `"${commandLine.replace(/"/g, '""')}"`;
  return `' Written by BewerbungsPilot to start its installer hidden.\r\nCreateObject("WScript.Shell").Run ${literal}, 0, False\r\n`;
}

export const WSCRIPT = () => path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'wscript.exe');

export interface StartHiddenDeps {
  spawn?: (file: string, args: string[], opts: { detached: true; stdio: 'ignore'; windowsHide: true; cwd: string; env: NodeJS.ProcessEnv }) => ChildProcess;
  wscript?: string;
}

/**
 * Writes `<cwd>\start-installer.vbs` and starts it with wscript. Resolves once wscript started (it exits right after
 * starting the command); rejects when the file cannot be written or wscript cannot start. `kill` stops only wscript:
 * the started program cannot be stopped from here — when it starts late, it simply does the update.
 */
export function startHidden(
  file: string,
  args: string[],
  opts: { cwd: string; env: NodeJS.ProcessEnv },
  deps: StartHiddenDeps = {},
): Promise<{ kill: () => void }> {
  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      const vbs = path.join(opts.cwd, 'start-installer.vbs');
      fs.writeFileSync(vbs, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(hiddenRunScript(file, args), 'utf16le')]));
      // //B: no message boxes from wscript itself (a failure shows up as the missing `running` status instead).
      child = (deps.spawn ?? nodeSpawn)(deps.wscript ?? WSCRIPT(), ['//B', '//NoLogo', vbs], {
        detached: true, stdio: 'ignore', windowsHide: true, cwd: opts.cwd, env: opts.env,
      });
    } catch (err) {
      reject(err);
      return;
    }
    child.once('error', reject);
    child.once('spawn', () => {
      child.on('error', () => undefined);
      child.unref();
      resolve({ kill: () => { try { child.kill(); } catch { /* already gone */ } } });
    });
  });
}
