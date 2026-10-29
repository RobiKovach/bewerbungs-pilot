import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AppError } from '../src/errors.js';
import { VacancyStore } from '../src/vacancies/store.js';
import { VACANCIES_SCHEMA_VERSION } from '../src/vacancies/schema.js';
import { vacancy } from './helpers/vacancies.js';

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp vac Дані-'));
  const paths = { file: path.join(dir, 'vacancies.json'), textsDir: path.join(dir, 'texts') };
  const events: string[] = [];
  const store = new VacancyStore(paths, (e) => events.push(e));
  store.load();
  return { dir, paths, store, events };
}

describe('VacancyStore', () => {
  it('starts empty, adds a card with its text, and reads both back after a restart', () => {
    const { paths, store } = setup();
    store.add(vacancy({ id: 'a1' }), 'Wir suchen Sie.');
    expect(store.list().map((v) => v.id)).toEqual(['a1']);
    expect(store.get('a1')?.hasText).toBe(true);
    const again = new VacancyStore(paths);
    expect(again.load()).toHaveLength(1);
    expect(again.readText('a1')).toBe('Wir suchen Sie.');
    expect(JSON.parse(fs.readFileSync(paths.file, 'utf8')).schemaVersion).toBe(VACANCIES_SCHEMA_VERSION);
  });

  it('get/list return copies', () => {
    const { store } = setup();
    store.add(vacancy({ id: 'a1' }), null);
    store.get('a1')!.title = 'changed';
    expect(store.get('a1')!.title).not.toBe('changed');
  });

  it('update changes one card; unknown id → VACANCY_NOT_FOUND; an invalid change is refused and nothing is written', () => {
    const { paths, store } = setup();
    store.add(vacancy({ id: 'a1' }), null);
    expect(store.update('a1', (v) => { v.status = 'favorite'; }).status).toBe('favorite');
    expect(() => store.update('nope', () => {})).toThrow(/VACANCY_NOT_FOUND/);
    const before = fs.readFileSync(paths.file, 'utf8');
    expect(() => store.update('a1', (v) => { (v as { status: string }).status = 'weird'; })).toThrow(AppError);
    expect(fs.readFileSync(paths.file, 'utf8')).toBe(before);
    expect(store.get('a1')!.status).toBe('favorite');
  });

  it('updateMany writes once and skips ids that are gone', () => {
    const { store } = setup();
    store.add(vacancy({ id: 'a1', scoreState: 'pending', score: null }), null);
    store.add(vacancy({ id: 'a2', scoreState: 'pending', score: null }), null);
    const out = store.updateMany(['a1', 'a2', 'gone'], (v) => { v.scoreState = 'notScored'; });
    expect(out.map((v) => v.id)).toEqual(['a1', 'a2']);
    expect(store.list().every((v) => v.scoreState === 'notScored')).toBe(true);
  });

  it('refuses unsafe ids for text files', () => {
    const { store } = setup();
    expect(() => store.add(vacancy({ id: '../evil' }), 'x')).toThrow(AppError);
    expect(store.readText('../evil')).toBeNull();
  });

  it('does not leave an orphaned text file when the card itself fails validation after the text was written', () => {
    const { store } = setup();
    expect(() => store.add(vacancy({ id: 'a1', title: 'T'.repeat(400) }), 'some text')).toThrow(AppError);
    expect(store.readText('a1')).toBeNull();
    expect(store.list()).toEqual([]);
  });

  it('compactHidden shrinks hidden Arbeitsagentur cards, keeps hidden manual ones and every other card', () => {
    const { store } = setup();
    store.add(vacancy({ id: 'h1', status: 'hidden', hiddenAt: '2026-09-28T10:00:00.000Z', locations: ['Dresden'], salaryText: '50k' }), 'text');
    store.add(vacancy({ id: 'm1', source: 'manual', sourceId: null, addedManually: true, status: 'hidden', hiddenAt: '2026-09-28T10:00:00.000Z' }), 'pasted');
    store.add(vacancy({ id: 'n1' }), 'text');
    expect(store.compactHidden()).toBe(1);
    const h1 = store.get('h1')!;
    expect(h1).toMatchObject({ status: 'hidden', title: expect.any(String) as string, company: expect.any(String) as string, sourceId: expect.any(String) as string, locations: [], salaryText: '', score: null, scoreState: 'notScored', hasText: false });
    expect(store.readText('h1')).toBeNull();
    expect(store.readText('m1')).toBe('pasted');
    expect(store.readText('n1')).toBe('text');
    expect(store.compactHidden()).toBe(0);
  });

  it('a broken file is put aside, never deleted, and the app starts empty', () => {
    const { dir, paths, events } = setup();
    fs.writeFileSync(paths.file, '{"schemaVersion": 1, "vac');
    const store = new VacancyStore(paths, (e) => events.push(e));
    expect(store.load()).toEqual([]);
    expect(fs.readdirSync(dir).some((f) => f.startsWith('vacancies.corrupt-'))).toBe(true);
    expect(events).toContain('vacancies_corrupt');
  });

  it('a file from a newer app version or with an invalid card is put aside as invalid', () => {
    for (const doc of [{ schemaVersion: 9, vacancies: [] }, { schemaVersion: 1, vacancies: [{ id: 'x' }] }]) {
      const { dir, paths } = setup();
      fs.writeFileSync(paths.file, JSON.stringify(doc));
      expect(new VacancyStore(paths).load()).toEqual([]);
      expect(fs.readdirSync(dir).some((f) => f.startsWith('vacancies.invalid-'))).toBe(true);
    }
  });

  it('a rejected update does not leak card content into the error, only a non-personal reason', () => {
    const { store } = setup();
    store.add(vacancy({ id: 'a1', title: 'Geheimer Titel', company: 'Geheime GmbH' }), null);
    let caught: AppError | undefined;
    try {
      store.update('a1', (v) => { (v as { status: string }).status = 'weird'; });
    } catch (err) {
      caught = err as AppError;
    }
    expect(caught).toBeInstanceOf(AppError);
    expect(caught!.detailsForLog).not.toContain('Geheimer Titel');
    expect(caught!.detailsForLog).not.toContain('Geheime GmbH');
    expect(caught!.detailsForLog).toContain('status');
  });

  it('an invalid file is set aside without card content leaking into the warn reason', () => {
    const { paths } = setup();
    const card = {
      ...vacancy({ id: 'x', title: 'Geheimer Titel', company: 'Geheime GmbH', contact: { email: 'geheim@example.com', salutation: 'Frau', name: 'Geheimer Name', phone: '', street: '', postcode: '', city: '' } }),
      status: 'weird',
    };
    fs.writeFileSync(paths.file, JSON.stringify({ schemaVersion: 1, vacancies: [card] }));
    const warned: { event: string; data: Record<string, unknown> }[] = [];
    const store = new VacancyStore(paths, (event, data) => warned.push({ event, data }));
    expect(store.load()).toEqual([]);
    expect(warned).toHaveLength(1);
    expect(warned[0].event).toBe('vacancies_invalid');
    const reason = String(warned[0].data.reason);
    expect(reason).not.toContain('Geheimer Titel');
    expect(reason).not.toContain('Geheime GmbH');
    expect(reason).not.toContain('geheim@example.com');
    expect(reason).not.toContain('Geheimer Name');
    expect(reason).toContain('status');
  });
});

describe('0.8.0: vacancies file v1 → v2', () => {
  it('v1 file -> v3: old scores get provider claude and an unknown language', () => {
    const { paths } = setup();
    const { provider: _p, language: _l, ...oldScore } = vacancy().score!;
    void _p; void _l;
    const scored = { ...vacancy({ id: 'old1' }), score: oldScore };
    const unscored = vacancy({ id: 'old2', scoreState: 'failed', score: null });
    fs.writeFileSync(paths.file, JSON.stringify({ schemaVersion: 1, vacancies: [scored, unscored] }));
    const events: string[] = [];
    const store = new VacancyStore(paths, (e) => events.push(e));
    store.load();
    expect(events).toEqual([]);
    expect(store.get('old1')!.score).toEqual({ ...oldScore, provider: 'claude', language: null });
    // Nothing else changed.
    expect(store.get('old1')).toEqual({ ...scored, score: { ...oldScore, provider: 'claude', language: null } });
    expect(store.get('old2')).toEqual(unscored);
    expect(fs.readdirSync(path.dirname(paths.file)).some((f) => f.includes('invalid'))).toBe(false);
  });

  it('a v2 score without provider (or with an unknown AI) is invalid', () => {
    const { paths } = setup();
    const { provider: _p, ...oldScore } = vacancy().score!;
    void _p;
    for (const score of [oldScore, { ...oldScore, provider: 'gemini' }]) {
      fs.writeFileSync(paths.file, JSON.stringify({ schemaVersion: 2, vacancies: [{ ...vacancy({ id: 'x' }), score }] }));
      const events: string[] = [];
      expect(new VacancyStore(paths, (e) => events.push(e)).load()).toEqual([]);
      expect(events).toEqual(['vacancies_invalid']);
    }
  });
});

describe('0.8.2: vacancies file v2 → v3', () => {
  it('v2 scores get language null (not known); cards without a score are unchanged', () => {
    const { paths } = setup();
    const { language: _l, ...v2Score } = vacancy().score!;
    void _l;
    const scored = { ...vacancy({ id: 'a' }), score: v2Score };
    const unscored = vacancy({ id: 'b', scoreState: 'failed', score: null });
    fs.writeFileSync(paths.file, JSON.stringify({ schemaVersion: 2, vacancies: [scored, unscored] }));
    const events: string[] = [];
    const store = new VacancyStore(paths, (e) => events.push(e));
    store.load();
    expect(events).toEqual([]);
    expect(store.get('a')).toEqual({ ...scored, score: { ...v2Score, language: null } });
    expect(store.get('b')).toEqual(unscored);
  });

  it('a v3 score with an unknown language is invalid', () => {
    const { paths } = setup();
    fs.writeFileSync(paths.file, JSON.stringify({ schemaVersion: 3, vacancies: [{ ...vacancy({ id: 'x' }), score: { ...vacancy().score!, language: 'fr' } }] }));
    const events: string[] = [];
    expect(new VacancyStore(paths, (e) => events.push(e)).load()).toEqual([]);
    expect(events).toEqual(['vacancies_invalid']);
  });
});

describe('0.8.0: a malformed v1 file is set aside, never emptied', () => {
  it.each([['a string', 'oops'], ['an object', { a: 1 }], ['a list with a non-object card', [null]]])('vacancies is %s → set aside, store starts empty, original kept', (_label, vacancies) => {
    const { dir, paths } = setup();
    const original = JSON.stringify({ schemaVersion: 1, vacancies });
    fs.writeFileSync(paths.file, original);
    const events: string[] = [];
    const store = new VacancyStore(paths, (e) => events.push(e));
    expect(store.load()).toEqual([]);
    expect(events).toEqual(['vacancies_invalid']);
    const aside = fs.readdirSync(dir).filter((f) => f.startsWith('vacancies.invalid-'));
    expect(aside).toHaveLength(1);
    expect(fs.readFileSync(path.join(dir, aside[0]), 'utf8')).toBe(original);
  });
});

describe('0.9.0: initiative flag', () => {
  it('is optional: kept after a restart when set, absent on other cards', () => {
    const { paths, store } = setup();
    store.add(vacancy({ id: 'i1', initiative: true }), 'Initiativbewerbung.');
    store.add(vacancy({ id: 'n1', title: 'Andere Stelle' }), 'Wir suchen Sie.');
    const again = new VacancyStore(paths);
    again.load();
    expect(again.get('i1')?.initiative).toBe(true);
    expect(Object.hasOwn(again.get('n1') ?? {}, 'initiative')).toBe(false);
  });
});

describe('0.9.1: vacancies file v3 → v4', () => {
  // Shaped like the real cards found on Robert's PC: the old code had replaced the offer link with the API's partner link.
  const offer = (refnr: string) => `https://www.arbeitsagentur.de/jobsuche/jobdetail/${refnr}`;
  const oldContact = { email: 'jobs@muster.example', salutation: 'Frau', name: 'Erika Beispiel' };
  const v3 = (over: Record<string, unknown>) => {
    const { contact: _c, ...rest } = vacancy();
    void _c;
    return { ...rest, contact: null, ...over };
  };

  it('AA cards always link to their offer; a real partner page moves to partnerUrl, the AA home page is dropped; contacts get empty phone/address', () => {
    const { paths } = setup();
    const cards = [
      v3({ id: 'home', sourceId: '10001-1003093507-S', url: 'http://www.arbeitsagentur.de', contact: oldContact }),
      v3({ id: 'company', sourceId: '10000-2222222222-S', url: 'https://primegate-consulting.de/' }),
      v3({ id: 'ok', sourceId: '10000-3333333333-S', url: offer('10000-3333333333-S') }),
      v3({ id: 'empty', sourceId: '10000-4444444444-S', url: '' }),
      v3({ id: 'manual', source: 'manual', sourceId: null, addedManually: true, url: 'https://muster.example/job', contact: oldContact }),
    ];
    fs.writeFileSync(paths.file, JSON.stringify({ schemaVersion: 3, vacancies: cards }));
    const events: string[] = [];
    const store = new VacancyStore(paths, (e) => events.push(e));
    store.load();
    expect(events).toEqual([]);
    const newContact = { ...oldContact, phone: '', street: '', postcode: '', city: '' };
    expect(store.get('home')).toEqual({ ...cards[0], url: offer('10001-1003093507-S'), contact: newContact });
    expect(store.get('company')).toEqual({ ...cards[1], url: offer('10000-2222222222-S'), partnerUrl: 'https://primegate-consulting.de/' });
    expect(store.get('ok')).toEqual(cards[2]);
    expect(store.get('empty')).toEqual({ ...cards[3], url: offer('10000-4444444444-S') });
    expect(store.get('manual')).toEqual({ ...cards[4], contact: newContact });
    expect(Object.hasOwn(store.get('home')!, 'partnerUrl')).toBe(false);
    expect(fs.readdirSync(path.dirname(paths.file)).some((f) => f.includes('invalid'))).toBe(false);
  });

  it('a v4 contact without the new fields is invalid; a partnerUrl that is not http(s) is invalid', () => {
    const { paths } = setup();
    for (const card of [v3({ id: 'x', contact: oldContact }), { ...vacancy({ id: 'y' }), partnerUrl: 'javascript:alert(1)' }]) {
      fs.writeFileSync(paths.file, JSON.stringify({ schemaVersion: 4, vacancies: [card] }));
      const events: string[] = [];
      expect(new VacancyStore(paths, (e) => events.push(e)).load()).toEqual([]);
      expect(events).toEqual(['vacancies_invalid']);
    }
  });
});
