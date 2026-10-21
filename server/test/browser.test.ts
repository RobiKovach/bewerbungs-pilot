import { describe, it, expect } from 'vitest';
import { browserCommand } from '../src/runtime/browser.js';

const url = 'http://127.0.0.1:4280/open?key=abc_-123';

describe('browserCommand', () => {
  it('on Windows uses the URL protocol handler, not explorer.exe (which drops URLs with a query)', () => {
    expect(browserCommand('win32', url)).toEqual(['rundll32.exe', ['url.dll,FileProtocolHandler', url]]);
  });

  it('passes the URL as one untouched argument on macOS and Linux', () => {
    expect(browserCommand('darwin', url)).toEqual(['open', [url]]);
    expect(browserCommand('linux', url)).toEqual(['xdg-open', [url]]);
  });
});
