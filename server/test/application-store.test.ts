import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { ApplicationStore } from '../src/applications/store.js';
import { pkg } from './helpers/applications.js';

function tmpStore() {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bp apps Дані-')), 'applications');
  const warnings: string[] = [];
  const store = new ApplicationStore(dir, (event) => warnings.push(event));
  store.load();
  return { dir, store, warnings };
}

describe('ApplicationStore', () => {
  it('save → list, get, byVacancy, vacancy text and photo; survives a reload', () => {
    const { dir, store } = tmpStore();
    const p = pkg();
    store.save(p, { vacancyText: 'Volltext der Stelle', photo: { data: Buffer.from([0xff, 0xd8, 0xff]), ext: '.jpg' } });
    expect(store.list().map((s) => [s.id, s.company, s.status])).toEqual([[p.id, 'Muster GmbH', 'draft']]);
    expect(store.require(p.id).letter.subject).toBe(p.letter.subject);
    expect(store.byVacancy(p.vacancyId)?.id).toBe(p.id);
    expect(store.readVacancyText(p.id)).toBe('Volltext der Stelle');
    expect(fs.readFileSync(store.photoPath(p.id)!)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    const again = new ApplicationStore(dir);
    again.load();
    expect(again.require(p.id)).toEqual(store.require(p.id));
  });

  it('update writes package and list; a change that makes the package invalid is refused and nothing changes', () => {
    const { store } = tmpStore();
    const p = store.save(pkg(), {});
    store.update(p.id, (x) => { x.status = 'approved'; x.approvedAt = '2026-09-29T11:00:00.000Z'; });
    expect(store.list()[0].status).toBe('approved');
    expect(() => store.update(p.id, (x) => { x.letter.paragraphs = []; })).toThrow(expect.objectContaining({ code: 'BAD_REQUEST' }));
    expect(store.require(p.id).letter.paragraphs).toHaveLength(3);
  });

  it('setPhoto replaces or removes the package photo and keeps snapshot.photo in step', () => {
    const { store } = tmpStore();
    const p = store.save(pkg(), { photo: { data: Buffer.from('a'), ext: '.jpg' } });
    store.setPhoto(p.id, { data: Buffer.from('b'), ext: '.png' });
    expect(store.require(p.id).snapshot.photo).toBe('.png');
    expect(fs.readFileSync(store.photoPath(p.id)!, 'utf8')).toBe('b');
    store.setPhoto(p.id, null);
    expect(store.photoPath(p.id)).toBeNull();
    expect(store.require(p.id).snapshot.photo).toBeNull();
  });

  it('remove deletes the folder and the list entry; unknown id → NOT_FOUND', () => {
    const { dir, store } = tmpStore();
    const p = store.save(pkg(), { vacancyText: 'x' });
    store.remove(p.id);
    expect(store.list()).toEqual([]);
    expect(fs.existsSync(path.join(dir, p.id))).toBe(false);
    expect(() => store.require(p.id)).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
  });

  it('a broken package.json is put aside (never deleted), left out of the list, and logged without its content', () => {
    const { dir, store, warnings } = tmpStore();
    const good = store.save(pkg(), {});
    const bad = store.save(pkg(), {});
    fs.writeFileSync(path.join(dir, bad.id, 'package.json'), '{"schemaVersion":1,"letter":{"paragraphs":["Geheimer Text"]}}');
    const again = new ApplicationStore(dir, (event, data) => warnings.push(`${event} ${JSON.stringify(data)}`));
    again.load();
    expect(again.list().map((s) => s.id)).toEqual([good.id]);
    expect(fs.readdirSync(path.join(dir, bad.id)).some((f) => f.startsWith('package.invalid-'))).toBe(true);
    expect(warnings.join('\n')).toContain('application_invalid');
    expect(warnings.join('\n')).not.toContain('Geheimer Text');
  });

  it('a broken applications.json is put aside and the list is rebuilt from the package folders', () => {
    const { dir, store } = tmpStore();
    const p = store.save(pkg(), {});
    fs.writeFileSync(path.join(dir, 'applications.json'), 'not json');
    const again = new ApplicationStore(dir);
    again.load();
    expect(again.list().map((s) => s.id)).toEqual([p.id]);
    expect(fs.readdirSync(dir).some((f) => f.startsWith('applications.corrupt-'))).toBe(true);
  });

  it('refuses unsafe ids (they become folder names)', () => {
    const { store } = tmpStore();
    expect(() => store.save(pkg({ id: '../evil' }), {})).toThrow(expect.objectContaining({ code: 'BAD_REQUEST' }));
    expect(store.get('../evil')).toBeUndefined();
  });

  it('accepts a letter written for the longest allowed vacancy company and profile name', () => {
    const { store } = tmpStore();
    const long = 'M'.repeat(300);
    const p = pkg();
    p.vacancy.company = long;
    p.letter.recipient = [long, 'Berlin'];
    p.letter.signature = long;
    expect(() => store.save(p, {})).not.toThrow();
  });
});
