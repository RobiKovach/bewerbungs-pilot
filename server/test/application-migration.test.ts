import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ApplicationStore } from '../src/applications/store.js';
import { validatePackage } from '../src/applications/schema.js';
import { pkg } from './helpers/applications.js';
import { cvHtml } from '../src/applications/render/cv.js';

/** A package as version 0.4.0 wrote it. */
function v1From(p: ReturnType<typeof pkg>) {
  const { headline: _h, headlineEditedByHand: _e, skillGroups, translations: _t, ...cv } = p.cv;
  void _h; void _e; void _t;
  const { links: _l, ...personal } = p.snapshot.personal;
  void _l;
  return { ...p, schemaVersion: 1, cv: { ...cv, skillOrder: skillGroups.flatMap((g) => g.skillIds) }, snapshot: { ...p.snapshot, personal } };
}

describe('package v1 → v2', () => {
  it('an old package.json loads: one unnamed group, no headline, no translations, no links', () => {
    const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bp mig-')), 'applications');
    const warnings: string[] = [];
    const p = pkg();
    const old = v1From(p);
    fs.mkdirSync(path.join(dir, p.id), { recursive: true });
    fs.writeFileSync(path.join(dir, p.id, 'package.json'), JSON.stringify(old));
    const store = new ApplicationStore(dir, (event) => warnings.push(event));
    store.load();
    const got = store.require(p.id);
    expect(warnings).toEqual([]);
    expect(got.schemaVersion).toBe(3);
    expect(got.cv).toMatchObject({ headline: '', headlineEditedByHand: false, translations: {}, skillGroups: [{ name: '', skillIds: old.cv.skillOrder }] });
    expect(got.snapshot.personal.links).toEqual([]);
    expect(validatePackage(got)).toBeNull();
  });

  it('a package that cannot be migrated is put aside, not loaded', () => {
    const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bp mig-')), 'applications');
    const warnings: string[] = [];
    const p = pkg();
    fs.mkdirSync(path.join(dir, p.id), { recursive: true });
    fs.writeFileSync(path.join(dir, p.id, 'package.json'), JSON.stringify({ ...v1From(p), schemaVersion: 9 }));
    const store = new ApplicationStore(dir, (event) => warnings.push(event));
    store.load();
    expect(store.list()).toEqual([]);
    expect(warnings).toEqual(['application_invalid']);
  });
});

function v2From(p: ReturnType<typeof pkg>) {
  const { history: _h, sentAt: _s, sentEmail: _e, ...rest } = p;
  void _h; void _s; void _e;
  return { ...rest, schemaVersion: 2 };
}

describe('package v2 → v3', () => {
  function loadOne(doc: unknown, id: string) {
    const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bp mig-')), 'applications');
    const warnings: string[] = [];
    fs.mkdirSync(path.join(dir, id), { recursive: true });
    fs.writeFileSync(path.join(dir, id, 'package.json'), JSON.stringify(doc));
    const store = new ApplicationStore(dir, (event) => warnings.push(event));
    store.load();
    return { got: store.require(id), warnings };
  }
  it('an approved v2 package gets one approved history entry', () => {
    const p = pkg({ status: 'approved', approvedAt: '2026-10-01T08:00:00.000Z' });
    const { got, warnings } = loadOne(v2From(p), p.id);
    expect(warnings).toEqual([]);
    expect(got.schemaVersion).toBe(3);
    expect(got.history).toEqual([{ kind: 'approved', at: '2026-10-01T08:00:00.000Z' }]);
    expect(got.sentAt).toBeNull();
    expect(got.sentEmail).toBeNull();
  });
  it('a draft v2 package gets an empty history', () => {
    const p = pkg();
    const { got } = loadOne(v2From(p), p.id);
    expect(got.history).toEqual([]);
  });
  it('a v1 package migrates 1 → 2 → 3', () => {
    const p = pkg();
    const { got, warnings } = loadOne(v1From(p), p.id);
    expect(warnings).toEqual([]);
    expect(got).toMatchObject({ schemaVersion: 3, history: [], sentAt: null, sentEmail: null });
  });
});

describe('a migrated v1 package prints every skill', () => {
  it('with a partial or empty skillOrder, skills outside it still appear in the CV', () => {
    for (const order of [['sk5'], []]) {
      const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bp mig-')), 'applications');
      const p = pkg();
      const old = v1From(p);
      old.cv.skillOrder = order;
      fs.mkdirSync(path.join(dir, p.id), { recursive: true });
      fs.writeFileSync(path.join(dir, p.id, 'package.json'), JSON.stringify(old));
      const store = new ApplicationStore(dir, () => {});
      store.load();
      const html = cvHtml(store.require(p.id), null);
      for (const name of ['JavaScript', 'WordPress', 'CSS', 'PHP', 'Git']) expect(html).toContain(name);
      expect(html).not.toContain('<strong></strong>');
    }
  });
});
