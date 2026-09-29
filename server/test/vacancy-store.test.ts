import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AppError } from '../src/errors.js';
import { VacancyStore } from '../src/vacancies/store.js';
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
    expect(JSON.parse(fs.readFileSync(paths.file, 'utf8')).schemaVersion).toBe(1);
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
      ...vacancy({ id: 'x', title: 'Geheimer Titel', company: 'Geheime GmbH', contact: { email: 'geheim@example.com', salutation: 'Frau', name: 'Geheimer Name' } }),
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
