// Fails CI when any language is missing a key, has an extra/empty key, or breaks a {{placeholder}}.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LANGUAGES = ['uk', 'en', 'de', 'ru', 'pl', 'ro'];

function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}

const placeholders = (s) => [...String(s).matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort().join(',');

export function checkLocales({ locales, base = 'en', usedKeys = [] }) {
  const problems = [];
  const ref = flatten(locales[base]);
  for (const [lang, data] of Object.entries(locales)) {
    if (lang === base) continue;
    const flat = flatten(data);
    for (const key of Object.keys(ref)) {
      if (!(key in flat)) { problems.push(`${lang}: missing key "${key}"`); continue; }
      if (placeholders(flat[key]) !== placeholders(ref[key])) {
        problems.push(`${lang}: placeholders differ in "${key}" (expected ${placeholders(ref[key]).split(',').filter(Boolean).map((p) => `{{${p}}}`).join(' ')})`);
      }
    }
    for (const key of Object.keys(flat)) if (!(key in ref)) problems.push(`${lang}: extra key "${key}"`);
    for (const [key, v] of Object.entries(flat)) if (String(v).trim() === '') problems.push(`${lang}: empty value "${key}"`);
  }
  for (const key of usedKeys) if (!(key in ref)) problems.push(`code uses unknown key "${key}"`);
  return problems;
}

function collectUsedKeys(dir) {
  const keys = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (entry.name !== 'test') keys.push(...collectUsedKeys(p)); continue; }
    if (!/\.(ts|tsx)$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) continue;
    const src = fs.readFileSync(p, 'utf8');
    for (const m of src.matchAll(/\bt\(\s*['"]([a-zA-Z0-9_.]+)['"]/g)) keys.push(m[1]);
  }
  return keys;
}

export function checkInstallerMessages(file) {
  if (!fs.existsSync(file)) return [];
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const problems = [];
  for (const lang of LANGUAGES) if (!data[lang]) problems.push(`installer: missing language "${lang}"`);
  if (!data.en) return problems;
  const locales = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v]));
  return problems.concat(checkLocales({ locales }).map((p) => `installer: ${p}`));
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const localesDir = path.join(webDir, 'src', 'locales');
  const locales = Object.fromEntries(
    LANGUAGES.map((l) => [l, JSON.parse(fs.readFileSync(path.join(localesDir, `${l}.json`), 'utf8'))]),
  );
  const problems = [
    ...checkLocales({ locales, usedKeys: collectUsedKeys(path.join(webDir, 'src')) }),
    ...checkInstallerMessages(path.join(webDir, '..', 'installer', 'messages.json')),
  ];
  if (problems.length) {
    console.error(`i18n check failed (${problems.length}):\n- ${problems.join('\n- ')}`);
    process.exit(1);
  }
  console.log(`i18n check passed: ${LANGUAGES.join(', ')}`);
}
