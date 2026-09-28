import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveDataRoot, dataPaths, ensureDataDirs } from '../src/data/paths.js';
import { writeJsonAtomic, readJson, CorruptJsonError } from '../src/data/atomic.js';
import { SettingsStore, DEFAULT_SETTINGS } from '../src/data/settings.js';
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
