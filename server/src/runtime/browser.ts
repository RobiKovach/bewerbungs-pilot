import { spawn } from 'node:child_process';

/**
 * Windows: explorer.exe silently opens nothing for a URL with a query string (our /open?key=…),
 * so the URL protocol handler is called directly; it takes the URL as one argument, no shell parsing.
 */
export function browserCommand(platform: NodeJS.Platform, url: string): [string, string[]] {
  return platform === 'win32' ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url]] :
    platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
}

// The URL is always our own http://127.0.0.1:<port>/ - never user text.
export function openBrowser(url: string): void {
  const [cmd, args] = browserCommand(process.platform, url);
  spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true }).on('error', () => {}).unref();
}
