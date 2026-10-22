// Checks a version.json the way the app will read it. Run: npm run check:version-json [file]
// Order: `npm run build` FIRST — this script imports parseVersionFile from server/dist, so the rules are never
// written twice (bp-release builds before it runs this). Exits 1 when the file would be ignored by the app.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const built = path.join(root, 'server', 'dist', 'updates', 'version-file.js');
if (!fs.existsSync(built)) {
  console.error(`Not built yet: ${built}\nRun "npm run build" first.`);
  process.exit(1);
}
const { parseVersionFile } = await import(pathToFileURL(built).href);

const file = path.resolve(process.argv[2] ?? path.join(root, 'docs', 'version.json'));
let raw;
try {
  raw = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (err) {
  console.error(`Cannot read ${file} as JSON: ${err.message}`);
  process.exit(1);
}
const parsed = parseVersionFile(raw);
if (parsed === null) {
  console.error(`INVALID: ${file} — the app would ignore it (schema must be 1, latest x.y.z, url a page under https://github.com/RobiKovach/bewerbungs-pilot/releases/).`);
  process.exit(1);
}
const cut = Object.entries(raw.notes ?? {}).filter(([lang, text]) => typeof text === 'string' && parsed.notes[lang] !== undefined && parsed.notes[lang] !== text);
console.log(`OK: ${file}\n  latest ${parsed.latest}, released ${parsed.released || '(none)'}\n  ${parsed.url}\n  notes: ${Object.keys(parsed.notes).join(', ') || '(none)'}`);
for (const [lang] of cut) console.warn(`  warning: notes.${lang} is longer than 300 characters and will be cut`);
const missing = ['uk', 'en', 'de', 'ru', 'pl', 'ro'].filter((l) => parsed.notes[l] === undefined);
if (missing.length > 0) console.warn(`  warning: no notes for ${missing.join(', ')} (English is shown instead)`);
