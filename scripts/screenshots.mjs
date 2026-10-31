// Screenshots for the README and the website, taken from the demo (spec 0.10.0): starts the built app on a throw-away
// data folder, clicks «Try the demo» like a new person and photographs the demo pages. Scripted AI, mail written to
// files, the update check points at a closed port: nothing leaves this PC and no real data is shown.
// Usage: npm run build && node scripts/screenshots.mjs [language=en] [out folder=docs/images] [scale=1]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const [language = 'en', outArg = 'docs/images', scaleArg = '1'] = process.argv.slice(2);
const out = path.resolve(ROOT, outArg);
const L = JSON.parse(fs.readFileSync(path.join(ROOT, 'web', 'src', 'locales', `${language}.json`), 'utf8'));
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function serverInfo(file, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`no ${file}`);
}

const api = (info, method, url, body) => fetch(`http://127.0.0.1:${info.port}${url}`, {
  method, headers: { 'x-bp-key': info.key, 'x-bp-client': '1', 'content-type': 'application/json' }, body: body && JSON.stringify(body),
});

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-shots-'));
const dataDir = path.join(base, 'data');
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(out, { recursive: true });
const app = spawn(process.execPath, [path.join(ROOT, 'server', 'dist', 'index.js'), '--no-open'], {
  cwd: ROOT, stdio: 'ignore', windowsHide: true,
  env: { ...process.env, BP_DATA_DIR: dataDir, BP_BACKUP_DIR: path.join(base, 'backups'), BP_UPDATE_URL: 'http://127.0.0.1:9/version.json' },
});

let browser;
try {
  const real = await serverInfo(path.join(dataDir, 'server.json'));
  await api(real, 'PATCH', '/api/settings', { language });
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: Number(scaleArg), locale: language });
  const page = await context.newPage();
  const shot = async (p, name) => {
    await p.waitForTimeout(400);
    await p.screenshot({ path: path.join(out, `${name}.png`) });
    console.log(`saved ${name}.png`);
  };

  await page.goto(`http://127.0.0.1:${real.port}/open?key=${encodeURIComponent(real.key)}`);
  const tryDemo = page.getByRole('button', { name: L.onboarding.welcome.tryDemo });
  await tryDemo.waitFor();
  await shot(page, '01-welcome');

  const [demo] = await Promise.all([context.waitForEvent('page'), tryDemo.click()]);
  await demo.getByRole('status', { name: L.demo.badge }).waitFor({ timeout: 40_000 });

  await demo.getByRole('link', { name: L.nav.vacancies }).first().click();
  await demo.getByRole('heading', { level: 1, name: L.vacancies.title }).waitFor();
  await demo.getByRole('article').first().waitFor();
  await shot(demo, '02-job-offers');

  await demo.getByRole('article').first().getByRole('button', { name: L.vacancies.card.interesting }).click();
  await demo.getByRole('tab', { name: new RegExp(`^${esc(L.vacancies.tabs.favorite)}`) }).click();
  const card = demo.getByRole('article').first();
  await card.getByRole('button', { name: L.applications.create.button }).click();
  await card.getByRole('radio', { name: L.applications.language.de }).check();
  await card.getByRole('button', { name: L.applications.create.start, exact: true }).click();
  const approve = demo.getByRole('button', { name: L.applications.approve, exact: true });
  await approve.waitFor({ timeout: 90_000 });
  await demo.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => !b.disabled && b.offsetParent), null, { timeout: 90_000 });
  await demo.waitForTimeout(2500); // the letter preview is printed by the browser
  await shot(demo, '03-package');
  await demo.getByRole('tab', { name: L.applications.tabs.cv, exact: true }).click();
  await demo.waitForTimeout(2500);
  await shot(demo, '04-cv');
  await demo.getByRole('tab', { name: L.applications.tabs.letter, exact: true }).click();

  await approve.click();
  await demo.getByRole('button', { name: L.applications.send.button, exact: true }).click();
  const dialog = demo.getByRole('dialog', { name: L.applications.send.title });
  const send = dialog.getByRole('button', { name: L.applications.send.submit, exact: true });
  await send.waitFor();
  await demo.waitForFunction(() => {
    const d = document.querySelector('[role=dialog]');
    return d && [...d.querySelectorAll('button')].some((b) => !b.disabled && /send|senden/i.test(b.textContent ?? ''));
  }, null, { timeout: 90_000 });
  await dialog.scrollIntoViewIfNeeded();
  await demo.waitForTimeout(400);
  await dialog.screenshot({ path: path.join(out, '05-send.png') });
  console.log('saved 05-send.png');
  await send.click();
  await dialog.waitFor({ state: 'detached', timeout: 90_000 });

  await demo.getByRole('link', { name: L.nav.applications }).first().click();
  await demo.getByRole('heading', { level: 1, name: L.applications.title }).waitFor();
  await shot(demo, '06-applications');

  const demoInfo = await serverInfo(path.join(dataDir, 'demo', 'server.json'));
  await api(demoInfo, 'POST', '/api/shutdown', {}).catch(() => undefined);
  await api(real, 'POST', '/api/shutdown', {}).catch(() => undefined);
} finally {
  await browser?.close();
  setTimeout(() => { app.kill(); fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); }, 2000);
}
