import { spawn } from 'node:child_process';

// The URL is always our own http://127.0.0.1:<port>/ - never user text.
export function openBrowser(url: string): void {
  const [cmd, args] =
    process.platform === 'win32' ? ['explorer.exe', [url]] :
    process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true }).on('error', () => {}).unref();
}
