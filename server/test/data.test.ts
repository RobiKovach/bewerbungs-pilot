import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveDataRoot, dataPaths, ensureDataDirs } from '../src/data/paths.js';
import { writeJsonAtomic, readJson, CorruptJsonError } from '../src/data/atomic.js';
import { SettingsStore, DEFAULT_SETTINGS, ONBOARDING_STEP_ORDER } from '../src/data/settings.js';
import { AppError } from '../src/errors.js';

// Spaces + Cyrillic on purpose: real users have folders like C:\Users\Ольга Коваль\.
const tempRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bp Дані з пробілом-'));

describe('data paths', () => {
  it('uses BP_DATA_DIR when set', () => {
    expect(resolveDataRoot({ BP_DATA_DIR: 'C:\\x\\y' })).toBe(path.resolve('C:\\x\\y'));
  });
  it('defaults to LOCALAPPDATA\\BewerbungsPilot', () => {
    expect(resolveDataRoot({ LOCALAPPDATA: 'C:\\L' })).toBe(path.join('C:\\L', 'BewerbungsPilot'));
  });
  it('creates logs and tmp in a path with spaces and Cyrillic letters', () => {
    const p = dataPaths(path.join(tempRoot(), 'BewerbungsPilot'));
    ensureDataDirs(p);
    expect(fs.statSync(p.logs).isDirectory()).toBe(true);
    expect(fs.statSync(p.tmp).isDirectory()).toBe(true);
    expect(fs.statSync(p.profileFiles).isDirectory()).toBe(true);
    expect(p.profileFile).toBe(path.join(p.root, 'profile', 'profile.json'));
  });
  it('knows the vacancy folders', () => {
    const p = dataPaths(path.join('C:', 'data'));
    expect(p.vacancies).toBe(path.join('C:', 'data', 'vacancies'));
    expect(p.vacanciesFile).toBe(path.join('C:', 'data', 'vacancies', 'vacancies.json'));
    expect(p.vacancyTexts).toBe(path.join('C:', 'data', 'vacancies', 'texts'));
    expect(p.searchState).toBe(path.join('C:', 'data', 'vacancies', 'search-state.json'));
  });
});

describe('atomic JSON', () => {
  it('round-trips and leaves no temp files', () => {
    const dir = tempRoot();
    const file = path.join(dir, 'a.json');
    writeJsonAtomic(file, { hello: 'світ' });
    writeJsonAtomic(file, { hello: 'Welt' });
    expect(readJson(file)).toEqual({ hello: 'Welt' });
    expect(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });
  it('returns null for a missing file', () => {
    expect(readJson(path.join(tempRoot(), 'missing.json'))).toBeNull();
  });
  it('throws CorruptJsonError for invalid JSON', () => {
    const file = path.join(tempRoot(), 'bad.json');
    fs.writeFileSync(file, '{"half":');
    expect(() => readJson(file)).toThrow(CorruptJsonError);
  });
});

describe('SettingsStore', () => {
  it('starts with defaults when there is no file', () => {
    const store = new SettingsStore(path.join(tempRoot(), 'settings.json'));
    expect(store.load()).toEqual(DEFAULT_SETTINGS);
  });
  it('backs up a corrupt file and starts with defaults', () => {
    const dir = tempRoot();
    const file = path.join(dir, 'settings.json');
    fs.writeFileSync(file, '{"language": "uk", "onboard');
    const warnings: string[] = [];
    const store = new SettingsStore(file, (event) => warnings.push(event));
    expect(store.load()).toEqual(DEFAULT_SETTINGS);
    expect(fs.existsSync(file)).toBe(false);
    expect(fs.readdirSync(dir).some((f) => f.startsWith('settings.corrupt-'))).toBe(true);
    expect(warnings).toEqual(['settings_corrupt']);
  });
  it('fills missing fields of an older file with defaults and drops invalid values', () => {
    const file = path.join(tempRoot(), 'settings.json');
    fs.writeFileSync(file, JSON.stringify({ language: 'fr', onboarding: { completed: true } }));
    const s = new SettingsStore(file).load();
    expect(s.language).toBeNull();
    expect(s.onboarding).toEqual({ currentStep: null, completed: true });
    expect(s.llm.timeoutSec).toBe(180);
  });
  it('persists patches and merges onboarding fields', () => {
    const file = path.join(tempRoot(), 'settings.json');
    const store = new SettingsStore(file);
    store.load();
    store.patch({ language: 'uk', onboarding: { currentStep: 'claude' } });
    store.patch({ onboarding: { completed: true } });
    const reloaded = new SettingsStore(file).load();
    expect(reloaded.language).toBe('uk');
    expect(reloaded.onboarding).toEqual({ currentStep: 'claude', completed: true });
  });
  it('reports DATA_WRITE_FAILED when the file cannot be written', () => {
    const dir = tempRoot();
    const store = new SettingsStore(path.join(dir, 'no-such-dir', 'settings.json'));
    store.load();
    expect(() => store.patch({ language: 'de' })).toThrow(AppError);
    try { store.patch({ language: 'de' }); } catch (e) { expect((e as AppError).code).toBe('DATA_WRITE_FAILED'); }
    expect(store.get().language).toBeNull();
  });
});

describe('settings: vacancies.publishedWithinDays', () => {
  const fresh = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bp-settings-')), 'settings.json');
  it('defaults to 14 days', () => {
    expect(new SettingsStore(fresh()).load().vacancies).toEqual({ publishedWithinDays: 14 });
  });
  it('keeps a valid stored value and repairs an invalid one', () => {
    const file = fresh();
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, language: 'de', vacancies: { publishedWithinDays: 7 } }));
    expect(new SettingsStore(file).load().vacancies.publishedWithinDays).toBe(7);
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, language: 'de', vacancies: { publishedWithinDays: 5 } }));
    expect(new SettingsStore(file).load().vacancies.publishedWithinDays).toBe(14);
  });
  it('patches it without touching the rest', () => {
    const s = new SettingsStore(fresh());
    s.load();
    s.patch({ language: 'uk' });
    expect(s.patch({ vacancies: { publishedWithinDays: 30 } })).toMatchObject({ language: 'uk', vacancies: { publishedWithinDays: 30 } });
  });
});

describe('settings: mail', () => {
  const fresh = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bp-settings-')), 'settings.json');
  const mail = { kind: 'smtp' as const, address: 'max@example.com', senderName: 'Max Mustermann', host: 'smtp.example.com', port: 587, security: 'starttls' as const, user: 'max@example.com', provider: 'gmx' };
  it('loads with mail null when settings.json has no mail', () => {
    const file = fresh();
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, language: 'de' }));
    expect(new SettingsStore(file).load().mail).toBeNull();
  });
  it('treats an invalid mail block as null', () => {
    const file = fresh();
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, mail: { ...mail, port: 'x' } }));
    expect(new SettingsStore(file).load().mail).toBeNull();
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, mail: { ...mail, security: 'none' } }));
    expect(new SettingsStore(file).load().mail).toBeNull();
  });
  it('a 0.6.0 mail block without kind loads as smtp; google is kept; broken or unknown kinds are null', () => {
    const file = fresh();
    const old: Record<string, unknown> = { ...mail };
    delete old.kind;
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, mail: old }));
    expect(new SettingsStore(file).load().mail).toEqual(mail);
    const g = { kind: 'google', address: 'max@gmail.com', senderName: 'Max Mustermann', provider: 'gmail' };
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, mail: g }));
    expect(new SettingsStore(file).load().mail).toEqual(g);
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, mail: { kind: 'google', senderName: 'x' } }));
    expect(new SettingsStore(file).load().mail).toBeNull();
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, mail: { kind: 'outlook' } }));
    expect(new SettingsStore(file).load().mail).toBeNull();
  });
  it('setMail writes, reloads and clears; patch keeps it', () => {
    const file = fresh();
    const s = new SettingsStore(file);
    s.load();
    expect(s.setMail(mail).mail).toEqual(mail);
    s.patch({ language: 'uk' });
    expect(new SettingsStore(file).load().mail).toEqual(mail);
    expect(s.setMail(null).mail).toBeNull();
    expect(new SettingsStore(file).load().mail).toBeNull();
  });
});

describe('settings v2 — llm.provider', () => {
  const write = (dir: string, doc: unknown) => fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(doc));
  const load = (dir: string) => { const s = new SettingsStore(path.join(dir, 'settings.json')); return s.load(); };
  const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bp-set-'));

  it('a v1 file with completed onboarding becomes claude', () => {
    const dir = tmpDir();
    write(dir, { schemaVersion: 1, language: 'uk', onboarding: { currentStep: null, completed: true }, llm: { timeoutSec: 180 } });
    expect(load(dir)).toMatchObject({ schemaVersion: 3, llm: { timeoutSec: 180, provider: 'claude' } });
  });
  it('a v1 file without completed onboarding gets null', () => {
    const dir = tmpDir();
    write(dir, { schemaVersion: 1, onboarding: { currentStep: 'claude', completed: false } });
    expect(load(dir).llm.provider).toBeNull();
  });
  it('a v1 file mid-onboarding past the Claude step becomes claude; at or before it stays null', () => {
    const dir = tmpDir();
    for (const step of ['profile', 'email', 'done']) {
      write(dir, { schemaVersion: 1, onboarding: { currentStep: step, completed: false } });
      expect(load(dir).llm.provider, step).toBe('claude');
    }
    for (const step of ['welcome', 'claude', 'something-else']) {
      write(dir, { schemaVersion: 1, onboarding: { currentStep: step, completed: false } });
      expect(load(dir).llm.provider, step).toBeNull();
    }
    write(dir, { schemaVersion: 2, onboarding: { currentStep: 'profile', completed: false }, llm: { timeoutSec: 180, provider: null } });
    expect(load(dir).llm.provider).toBeNull();
  });
  it('the server step order matches the web onboarding steps', () => {
    const src = fs.readFileSync(new URL('../../web/src/onboarding/steps.ts', import.meta.url), 'utf8');
    const ids = [...src.matchAll(/\{ id: '([a-z-]+)'/g)].map((m) => m[1]);
    expect(ids).toEqual([...ONBOARDING_STEP_ORDER]);
  });
  it('a v2 file keeps null even when onboarding is completed ("continue anyway")', () => {
    const dir = tmpDir();
    write(dir, { schemaVersion: 2, onboarding: { currentStep: null, completed: true }, llm: { timeoutSec: 180, provider: null } });
    expect(load(dir).llm.provider).toBeNull();
  });
  it('a v2 file keeps chatgpt; an unknown provider becomes null', () => {
    const dir = tmpDir();
    write(dir, { schemaVersion: 2, llm: { provider: 'chatgpt' } });
    expect(load(dir).llm.provider).toBe('chatgpt');
    write(dir, { schemaVersion: 2, llm: { provider: 'gpt' } });
    expect(load(dir).llm.provider).toBeNull();
  });
  it('patch sets the provider and keeps the timeout', () => {
    const dir = tmpDir();
    const s = new SettingsStore(path.join(dir, 'settings.json'));
    s.load();
    expect(s.patch({ llm: { provider: 'chatgpt' } }).llm).toEqual({ timeoutSec: 180, provider: 'chatgpt' });
    expect(new SettingsStore(path.join(dir, 'settings.json')).load().llm.provider).toBe('chatgpt');
  });
});

describe('settings v3 — updates', () => {
  const write = (dir: string, doc: unknown) => fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(doc));
  const load = (dir: string) => new SettingsStore(path.join(dir, 'settings.json')).load();
  const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bp-set3-'));

  it('defaults to checking, nothing dismissed', () => {
    expect(DEFAULT_SETTINGS.schemaVersion).toBe(3);
    expect(DEFAULT_SETTINGS.updates).toEqual({ check: true, dismissedVersion: null });
  });
  it('a v2 file becomes v3 with the check on; provider and the rest unchanged', () => {
    const dir = tmpDir();
    const mail = { kind: 'google', address: 'a@x.de', senderName: 'Max', provider: 'gmail' };
    write(dir, { schemaVersion: 2, language: 'uk', onboarding: { currentStep: null, completed: true }, llm: { timeoutSec: 240, provider: 'chatgpt' }, vacancies: { publishedWithinDays: 7 }, mail });
    expect(load(dir)).toEqual({
      schemaVersion: 3, language: 'uk', onboarding: { currentStep: null, completed: true }, llm: { timeoutSec: 240, provider: 'chatgpt' },
      vacancies: { publishedWithinDays: 7 }, mail, updates: { check: true, dismissedVersion: null },
    });
    // v2 with completed onboarding and no provider stays null — the v1 rule applies to neither v2 nor v3.
    write(dir, { schemaVersion: 2, onboarding: { currentStep: null, completed: true }, llm: { timeoutSec: 180, provider: null } });
    expect(load(dir).llm.provider).toBeNull();
    write(dir, { schemaVersion: 3, onboarding: { currentStep: null, completed: true }, llm: { timeoutSec: 180, provider: null } });
    expect(load(dir).llm.provider).toBeNull();
  });
  it('a v1 file goes straight to v3 (provider rule as before)', () => {
    const dir = tmpDir();
    write(dir, { schemaVersion: 1, onboarding: { currentStep: null, completed: true } });
    expect(load(dir)).toMatchObject({ schemaVersion: 3, llm: { provider: 'claude' }, updates: { check: true, dismissedVersion: null } });
  });
  it('a v3 file keeps its values; broken values fall back', () => {
    const dir = tmpDir();
    write(dir, { schemaVersion: 3, updates: { check: false, dismissedVersion: '0.9.1' } });
    expect(load(dir).updates).toEqual({ check: false, dismissedVersion: '0.9.1' });
    write(dir, { schemaVersion: 3, updates: { check: 'no', dismissedVersion: '<b>' } });
    expect(load(dir).updates).toEqual({ check: true, dismissedVersion: null });
  });
  it('patch({ updates: { check: false } }) persists and keeps the dismissed version', () => {
    const dir = tmpDir();
    const s = new SettingsStore(path.join(dir, 'settings.json'));
    s.load();
    s.dismissUpdate('0.9.1');
    expect(s.patch({ updates: { check: false } }).updates).toEqual({ check: false, dismissedVersion: '0.9.1' });
    expect(load(dir).updates).toEqual({ check: false, dismissedVersion: '0.9.1' });
    expect(s.patch({ language: 'de' }).updates).toEqual({ check: false, dismissedVersion: '0.9.1' });
  });
});
