import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// 0.12.0, faster start: these libraries are hundreds of files each (~600 together), and a cold start reads every file
// the server imports. They are needed only for PDFs, Word files, mail and the browser windows, so they are loaded
// on first use with `await import(...)`. A plain `import x from '…'` (not `import type`) would bring them back at start.
const LAZY = ['puppeteer-core', 'pdf-lib', 'mammoth', 'nodemailer', 'google-auth-library'];

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');
const files = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? files(path.join(dir, e.name)) : e.name.endsWith('.ts') ? [path.join(dir, e.name)] : []);

/** True when every imported name is `type`-only, so TypeScript drops the import from the built file. */
const typeOnly = (stmt: string): boolean => {
  if (/^import\s+type\b/.test(stmt)) return true;
  const braces = /^import\s*\{([^}]*)\}\s*from/.exec(stmt);
  return braces !== null && braces[1].split(',').map((s) => s.trim()).filter(Boolean).every((s) => s.startsWith('type '));
};

describe('heavy libraries are not loaded at start', () => {
  it('no server file imports them statically', () => {
    const offenders: string[] = [];
    for (const f of files(src)) {
      const text = fs.readFileSync(f, 'utf8');
      // import … from '…', export … from '…' and side-effect imports (import '…'), with either quote.
      for (const m of text.matchAll(/^(?:import|export)\s[^;]*?['"]([^'"]+)['"];/gms)) {
        const lib = LAZY.find((l) => m[1] === l || m[1].startsWith(`${l}/`));
        if (lib && !typeOnly(m[0])) offenders.push(`${path.relative(src, f)}: ${m[0].split('\n')[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the check itself recognises a value import and a type-only import', () => {
    expect(typeOnly("import puppeteer, { type Browser } from 'puppeteer-core';")).toBe(false);
    expect(typeOnly("import { PDFDocument } from 'pdf-lib';")).toBe(false);
    expect(typeOnly("import { type Browser, type Page } from 'puppeteer-core';")).toBe(true);
    expect(typeOnly("import type { OAuth2Client } from 'google-auth-library';")).toBe(true);
    expect(typeOnly("import 'puppeteer-core';")).toBe(false);
    expect(typeOnly("export { PDFDocument } from 'pdf-lib';")).toBe(false);
  });
});
