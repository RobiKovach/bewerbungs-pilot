import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SettingsStore } from '../src/data/settings.js';
import { DemoLauncher, demoDataRoot, isDemoStart, seedDemo } from '../src/demo/demo.js';
import { MemorySecretStore } from '../src/mail/secret.js';
import { readiness } from '../src/profile/readiness.js';
import { validateProfile } from '../src/profile/schema.js';
import { ProfileStore } from '../src/profile/store.js';
import { VacancyStore } from '../src/vacancies/store.js';
import { makeApp } from './helpers/app.js';

function stores() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp demo-'));
  const settings = new SettingsStore(path.join(dir, 'settings.json'));
  settings.load();
  fs.mkdirSync(path.join(dir, 'profile'));
  const profileStore = new ProfileStore(path.join(dir, 'profile', 'profile.json'));
  profileStore.load();
  const vacancyStore = new VacancyStore({ file: path.join(dir, 'vacancies', 'vacancies.json'), textsDir: path.join(dir, 'vacancies', 'texts') });
  fs.mkdirSync(path.join(dir, 'vacancies', 'texts'), { recursive: true });
  vacancyStore.load();
  return { dir, settings, profileStore, vacancyStore, secrets: new MemorySecretStore() };
}

describe('demo data (spec 0.10.0: «Try the demo»)', () => {
  it('lives in its own folder next to the real data, never in it', () => {
    expect(demoDataRoot(path.join('C:', 'Users', 'max', 'AppData', 'Local', 'BewerbungsPilot')))
      .toBe(path.join('C:', 'Users', 'max', 'AppData', 'Local', 'BewerbungsPilot', 'demo'));
  });

  it('seeds a ready profile of the fictional Max Mustermann, finished onboarding and a mailbox that writes to files', async () => {
    const s = stores();
    await seedDemo({ ...s, language: 'de' });

    const profile = s.profileStore.get();
    expect(validateProfile(profile)).toBeNull();
    expect(readiness(profile)).toEqual({ ready: true, missing: [], warnings: [] });
    expect(profile.sections.personal.data.fullName).toBe('Max Mustermann');
    expect(profile.sections.personal.data.email).toMatch(/@example\.com$/);
    expect(profile.sections.wishes.data.jobTitles.length).toBeGreaterThan(0);
    expect(profile.stories.length).toBeGreaterThanOrEqual(2);
    expect(profile.wizard.completedAt).not.toBeNull();

    const settings = s.settings.get();
    expect(settings.language).toBe('de');
    expect(settings.onboarding).toEqual({ currentStep: null, completed: true });
    expect(settings.llm.provider).toBe('claude');
    expect(settings.mail).toMatchObject({ kind: 'smtp', address: 'max.mustermann@example.com' });
    expect(await s.secrets.load()).not.toBeNull();

    // Fictional offers with scores and full texts, so a package can be made at once without searching the job board.
    const offers = s.vacancyStore.list();
    expect(offers.length).toBe(3);
    for (const v of offers) {
      expect(v.scoreState).toBe('scored');
      expect(v.contact?.email).toMatch(/[@.]example\.com$/);
      expect(s.vacancyStore.readText(v.id)).toContain(v.title);
    }
    expect(offers.map((v) => v.status)).toEqual(['new', 'new', 'new']);
    // A German demo gets the points in German; other languages get English ones and the card's «Score again».
    expect(offers.every((v) => v.score?.language === 'de')).toBe(true);
  });

  it('keeps what the person changed in the demo on the next start', async () => {
    const s = stores();
    await seedDemo({ ...s, language: 'en' });
    s.profileStore.update((p) => { p.sections.personal.data.city = 'Hamburg'; });
    await seedDemo({ ...s, language: 'uk' });
    expect(s.profileStore.get().sections.personal.data.city).toBe('Hamburg');
    expect(s.vacancyStore.list()).toHaveLength(3);
    expect(s.settings.get().language).toBe('en');
  });
});

describe('a normal start (no «Try the demo» click)', () => {
  it('is never the demo: only --demo or BP_DEMO=1, which only the demo button sets, starts it', () => {
    expect(isDemoStart(['node', 'index.js'], {})).toBe(false);
    expect(isDemoStart(['node', 'index.js', '--no-open', '--fake-llm'], { BP_FAKE_LLM: '1', BP_DEMO_LANGUAGE: 'de' })).toBe(false);
    expect(isDemoStart(['node', 'index.js', '--demo', '--no-open'], {})).toBe(true);
    expect(isDemoStart(['node', 'index.js'], { BP_DEMO: '1' })).toBe(true);
  });

  it('starts with an empty profile and no sample offers, so the person fills in their own', () => {
    const s = stores();
    const profile = s.profileStore.get();
    expect(profile.sections.personal.data.fullName ?? '').toBe('');
    expect(JSON.stringify(profile)).not.toContain('Mustermann');
    expect(profile.stories).toHaveLength(0);
    expect(profile.wizard.completedAt).toBeNull();
    expect(s.vacancyStore.list()).toHaveLength(0);
    expect(s.settings.get().onboarding.completed).toBe(false);
    expect(s.settings.get().mail).toBeNull();
  });
});

describe('demo launcher', () => {
  it('starts a second, hidden copy of the app on the demo folder with scripted AI', async () => {
    const calls: { args: string[]; env: NodeJS.ProcessEnv; windowsHide: boolean | undefined }[] = [];
    let running: { port: number; key: string } | null = null;
    const launcher = new DemoLauncher({
      dataRoot: path.join('X:', 'data'), entry: path.join('X:', 'app', 'index.js'),
      spawn: (_file, args, opts) => { calls.push({ args, env: opts.env ?? {}, windowsHide: opts.windowsHide }); running = { port: 4291, key: 'demo-key' }; },
      find: async () => running,
      waitMs: 1000, intervalMs: 1,
    });

    const { url } = await launcher.start('ro');
    expect(url).toBe('http://127.0.0.1:4291/open?key=demo-key');
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toEqual([path.join('X:', 'app', 'index.js'), '--demo', '--no-open']);
    expect(calls[0].env.BP_DATA_DIR).toBe(path.join('X:', 'data', 'demo'));
    expect(calls[0].env.BP_DEMO_LANGUAGE).toBe('ro');
    expect(calls[0].windowsHide).toBe(true);
  });

  it('reuses a demo that is already running', async () => {
    let spawned = 0;
    const launcher = new DemoLauncher({
      dataRoot: 'X:', entry: 'index.js', spawn: () => { spawned++; }, find: async () => ({ port: 4290, key: 'k' }),
    });
    expect((await launcher.start('en')).url).toBe('http://127.0.0.1:4290/open?key=k');
    expect(spawned).toBe(0);
  });

  it('gives up when the demo does not come up in time', async () => {
    const launcher = new DemoLauncher({ dataRoot: 'X:', entry: 'index.js', spawn: () => {}, find: async () => null, waitMs: 20, intervalMs: 5 });
    await expect(launcher.start('en')).rejects.toMatchObject({ code: 'DEMO_FAILED' });
  });
});

describe('demo routes', () => {
  it('health says whether this copy is the demo', async () => {
    const { app } = await makeApp();
    expect((await app.inject({ method: 'GET', url: '/api/health' })).json()).toMatchObject({ demo: false });
    const demo = await makeApp({ demo: { active: true } });
    expect((await demo.app.inject({ method: 'GET', url: '/api/health' })).json()).toMatchObject({ demo: true });
  });

  it('POST /api/demo starts the demo in the chosen language and answers with its address', async () => {
    const asked: string[] = [];
    const { app } = await makeApp({ demo: { active: false, start: async (language) => { asked.push(language); return { url: 'http://127.0.0.1:4291/open?key=x' }; } } });
    const r = await app.inject({ method: 'POST', url: '/api/demo', headers: { 'x-bp-client': '1' }, payload: { language: 'pl' } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ url: 'http://127.0.0.1:4291/open?key=x' });
    expect(asked).toEqual(['pl']);
  });

  it('the demo itself cannot start another demo', async () => {
    const { app } = await makeApp({ demo: { active: true, start: async () => ({ url: 'x' }) } });
    const r = await app.inject({ method: 'POST', url: '/api/demo', headers: { 'x-bp-client': '1' }, payload: { language: 'en' } });
    expect(r.statusCode).toBe(400);
  });

  it('needs the launch key like every other write', async () => {
    const { app } = await makeApp({ autoKey: false, demo: { active: false, start: async () => ({ url: 'x' }) } });
    const r = await app.inject({ method: 'POST', url: '/api/demo', headers: { 'x-bp-client': '1' }, payload: { language: 'en' } });
    expect(r.statusCode).toBe(401);
  });
});
