// Manual live check of the company research (0.13.0, plan task 12). Never part of npm test, never saves anything.
// Run: npm run check:research -- <vacancy url> --company "<Firma GmbH>" [--partner <url>] [--website <url>] [--contact-only] [--show]
//   --partner   Arbeitsagentur case: the vacancy page is skipped and this employer link is read first (Ruling R6).
//   --website   a company site the person typed (used without a name check).
//   --show      print the found contact values; by default only which fields were found (names of real people stay
//               off the screen and out of copied logs) and the e-mail's domain.
// The program reads the pages with the same safe reader as the app (public addresses only, no pictures, one browser);
// news follow the app (newsSource: NEWS_ENABLED is false — no news service is asked). The AI summary is not run here: only what the AI
// helper would be given is measured.
import { collect, type CollectInput, type CollectMode } from '../src/research/collect.js';
import { newsSource } from '../src/research/news.js';
import { companyResearchTask } from '../src/research/task.js';
import { BrowserPageReader } from '../src/vacancies/sources/page-reader.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function usage(msg: string): never {
  console.error(`${msg}\nUsage: npm run check:research -- <vacancy url> --company "<name>" [--partner <url>] [--website <url>] [--contact-only] [--show]`);
  process.exit(1);
}

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string): string => {
  const i = args.indexOf(name);
  if (i < 0) return '';
  const v = args[i + 1];
  if (!v || v.startsWith('--')) usage(`${name} needs a value.`);
  return v;
};
const company = value('--company');
const partner = value('--partner');
const website = value('--website');
const valued = new Set(['--company', '--partner', '--website']);
const positional = args.filter((a, i) => !a.startsWith('--') && !valued.has(args[i - 1] ?? ''));
if (positional.length > 1) usage('Expected at most one vacancy url.');
const vacancyUrl = positional[0] ?? '';
if (!vacancyUrl && !partner && !company) usage('Give a vacancy url, a --partner link or at least a --company name.');
const mode: CollectMode = flag('--contact-only') ? 'contact' : 'full';
const show = flag('--show');

const input: CollectInput = { vacancyUrl, partnerUrl: partner, company, websiteHint: website, skipVacancyPage: Boolean(partner) };
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-check-research-'));
const reader = new BrowserPageReader({
  tmpRoot,
  log: (event, data) => console.log(`  [${event}] ${data.host}: ${data.result}`),
  warn: (event, data) => console.warn(`  [${event}]`, data),
});

const started = Date.now();
try {
  const c = await collect(input, mode, { reader, fetchNews: newsSource(), now: () => new Date() }, new AbortController().signal);
  console.log(`\nmode ${mode}, ${((Date.now() - started) / 1000).toFixed(1)} s`);
  console.log(`website: ${c.website || '(not found)'}`);
  console.log(`pages read (${c.pages.length}):`);
  for (const p of c.pages) console.log(`  ${p.kind.padEnd(9)} ${p.url}  (${p.text.length} chars, ${p.links.length} links)`);
  const found = Object.entries(c.contact).filter(([, v]) => v);
  console.log('contact:');
  if (found.length === 0) console.log('  (nothing)');
  for (const [k, v] of found) {
    const shown = show ? v : k === 'email' ? `…@${v.split('@')[1]}` : '(found)';
    console.log(`  ${k}: ${shown}`);
  }
  if (c.newsOff) console.log('news: off (no news service is asked)');
  else if (c.news === null) console.log(mode === 'full' ? 'news: could not be loaded' : 'news: not asked (contact mode)');
  else {
    console.log(`news (${c.news.length}):`);
    for (const n of c.news) console.log(`  ${n.date} ${n.source}: ${n.title}`);
  }
  if (mode === 'full' && company) {
    const task = companyResearchTask(company, c, 'de');
    console.log(`AI input: ${task.prompt.length} characters (not sent)`);
  }
} catch (err) {
  console.error('research failed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  fs.rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
