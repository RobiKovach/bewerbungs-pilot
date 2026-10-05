import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ApplicationStore } from '../src/applications/store.js';
import { validatePackage } from '../src/applications/schema.js';
import { pkg } from './helpers/applications.js';

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
    expect(got.schemaVersion).toBe(2);
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
