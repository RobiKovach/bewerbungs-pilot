import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ApplicationStore } from '../src/applications/store.js';
import { PACKAGE_MIGRATIONS, PACKAGE_SCHEMA_VERSION, validatePackage } from '../src/applications/schema.js';
import { migrate } from '../src/data/migrate.js';
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
    expect(got.schemaVersion).toBe(5);
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
    expect(got.schemaVersion).toBe(5);
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
    expect(got).toMatchObject({ schemaVersion: 5, history: [], sentAt: null, sentEmail: null });
  });
});

describe('an applications.json from 0.5.x', () => {
  it('stays valid next to a v2 package: no warning, nothing set aside', () => {
    const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bp mig-')), 'applications');
    const warnings: string[] = [];
    const p = pkg({ status: 'approved', approvedAt: '2026-10-01T08:00:00.000Z' });
    fs.mkdirSync(path.join(dir, p.id), { recursive: true });
    fs.writeFileSync(path.join(dir, p.id, 'package.json'), JSON.stringify(v2From(p)));
    const summary = {
      id: p.id, vacancyId: p.vacancyId, company: p.vacancy.company, title: p.vacancy.title, language: p.language, status: p.status,
      createdAt: p.createdAt, updatedAt: p.updatedAt, approvedAt: p.approvedAt,
    };
    fs.writeFileSync(path.join(dir, 'applications.json'), JSON.stringify({ schemaVersion: 1, applications: [summary] }));
    const store = new ApplicationStore(dir, (event) => warnings.push(event));
    expect(store.load().map((s) => s.id)).toEqual([p.id]);
    expect(warnings).toEqual([]);
    expect(fs.readdirSync(dir).filter((f) => f.includes('invalid') || f.includes('corrupt'))).toEqual([]);
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

describe('package v3 → v4', () => {
  function loadOne(doc: unknown, id: string) {
    const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bp mig-')), 'applications');
    fs.mkdirSync(path.join(dir, id), { recursive: true });
    fs.writeFileSync(path.join(dir, id, 'package.json'), JSON.stringify(doc));
    const warnings: string[] = [];
    const store = new ApplicationStore(dir, (event) => warnings.push(event));
    store.load();
    return { got: store.require(id), warnings };
  }
  it('a v3 package loads as v4 with offerReply null and the same history', () => {
    const history = [{ kind: 'approved', at: '2026-10-01T08:00:00.000Z' }, { kind: 'sent', at: '2026-10-02T08:00:00.000Z', to: 'jobs@muster.example', messageId: '<m@x>' }];
    const p = pkg({ status: 'sent', history: history as never });
    const { offerReply: _o, ...v3 } = p;
    void _o;
    const { got, warnings } = loadOne({ ...v3, schemaVersion: 3 }, p.id);
    expect(warnings).toEqual([]);
    expect(got.schemaVersion).toBe(5);
    expect(got.offerReply).toBeNull();
    expect(got.history).toEqual(history);
  });
  it('a v2 approved package still migrates 2 → 3 → 4', () => {
    const p = pkg({ status: 'approved', approvedAt: '2026-10-01T08:00:00.000Z' });
    const { history: _h, sentAt: _s, sentEmail: _e, offerReply: _o, ...rest } = p;
    void _h; void _s; void _e; void _o;
    const { got, warnings } = loadOne({ ...rest, schemaVersion: 2 }, p.id);
    expect(warnings).toEqual([]);
    expect(got).toMatchObject({ schemaVersion: 5, offerReply: null, history: [{ kind: 'approved', at: '2026-10-01T08:00:00.000Z' }] });
  });
});

describe('0.7.1: Gmail conversation id on history entries', () => {
  it('a hex threadId is valid; anything else is refused (it is sent to Google later)', () => {
    const ok = pkg({ status: 'sent', history: [{ kind: 'sent', at: '2026-10-05T10:00:00.000Z', messageId: '1a13e5cf', threadId: '1a13e5cfb151d3ae' }] });
    expect(validatePackage(ok)).toBeNull();
    const bad = pkg({ status: 'sent', history: [{ kind: 'sent', at: '2026-10-05T10:00:00.000Z', threadId: '"},{"x":1' }] });
    expect(validatePackage(bad)).not.toBeNull();
  });

  it('a package from 0.7.0 (no threadId) stays valid', () => {
    expect(validatePackage(pkg({ status: 'sent', history: [{ kind: 'sent', at: '2026-10-05T10:00:00.000Z', messageId: '1a13e5cf' }] }))).toBeNull();
  });
});

/** A package as 0.5.0–0.7.x wrote it (before "who wrote it" existed). */
function v4From(p: ReturnType<typeof pkg>) {
  const { writtenBy: _w, ...rest } = p;
  void _w;
  return { ...rest, schemaVersion: 4 };
}

describe('0.8.0: who wrote the package', () => {
  it('v4 -> v5: old packages were written by Claude', () => {
    const doc = migrate(v4From(pkg()), PACKAGE_SCHEMA_VERSION, PACKAGE_MIGRATIONS);
    expect(doc).toMatchObject({ schemaVersion: 5, writtenBy: 'claude' });
    expect(validatePackage(doc)).toBeNull();
  });

  it('a v5 package without writtenBy (or with an unknown AI) is invalid', () => {
    expect(validatePackage(v4From(pkg()))).not.toBeNull();
    expect(validatePackage({ ...pkg(), writtenBy: 'gemini' })).not.toBeNull();
    expect(validatePackage(pkg({ writtenBy: 'chatgpt' }))).toBeNull();
  });

  it('an applications.json v1 is migrated, not set aside', () => {
    const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bp mig-')), 'applications');
    const warnings: string[] = [];
    const p = pkg({ status: 'approved', approvedAt: '2026-10-01T08:00:00.000Z', history: [{ kind: 'approved', at: '2026-10-01T08:00:00.000Z' }] });
    const old = v4From(p);
    fs.mkdirSync(path.join(dir, p.id), { recursive: true });
    fs.writeFileSync(path.join(dir, p.id, 'package.json'), JSON.stringify(old));
    const summary = {
      id: p.id, vacancyId: p.vacancyId, company: p.vacancy.company, title: p.vacancy.title, language: p.language, status: p.status,
      createdAt: p.createdAt, updatedAt: p.updatedAt, approvedAt: p.approvedAt,
    };
    fs.writeFileSync(path.join(dir, 'applications.json'), JSON.stringify({ schemaVersion: 1, applications: [summary] }));
    const store = new ApplicationStore(dir, (event) => warnings.push(event));
    store.load();
    expect(warnings).not.toContain('applications_invalid');
    expect(warnings).toEqual([]);
    expect(store.list()[0].writtenBy).toBe('claude');
    expect(fs.readdirSync(dir).filter((f) => f.includes('invalid') || f.includes('corrupt'))).toEqual([]);
    // Nothing else changed: the migrated package equals the old one plus writtenBy.
    expect(store.require(p.id)).toEqual({ ...old, schemaVersion: 5, writtenBy: 'claude' });
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'applications.json'), 'utf8'))).toMatchObject({ schemaVersion: 2, applications: [{ id: p.id, writtenBy: 'claude' }] });
  });

  it('an applications.json from a newer app is set aside and rebuilt from the folders', () => {
    const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bp mig-')), 'applications');
    const warnings: string[] = [];
    const p = pkg();
    fs.mkdirSync(path.join(dir, p.id), { recursive: true });
    fs.writeFileSync(path.join(dir, p.id, 'package.json'), JSON.stringify(p));
    fs.writeFileSync(path.join(dir, 'applications.json'), JSON.stringify({ schemaVersion: 9, applications: [] }));
    const store = new ApplicationStore(dir, (event) => warnings.push(event));
    expect(store.load().map((s) => s.id)).toEqual([p.id]);
    expect(warnings).toEqual(['applications_invalid']);
  });
});

describe('0.8.0: a malformed v1 applications.json is set aside and rebuilt, never emptied', () => {
  it.each([['a string', 'oops'], ['an object', { a: 1 }]])('applications is %s → set aside, every package folder still loads', (_label, applications) => {
    const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bp mig-')), 'applications');
    const warnings: string[] = [];
    const p = pkg();
    fs.mkdirSync(path.join(dir, p.id), { recursive: true });
    fs.writeFileSync(path.join(dir, p.id, 'package.json'), JSON.stringify(v4From(p)));
    const original = JSON.stringify({ schemaVersion: 1, applications });
    fs.writeFileSync(path.join(dir, 'applications.json'), original);
    const store = new ApplicationStore(dir, (event) => warnings.push(event));
    expect(store.load().map((s) => s.id)).toEqual([p.id]);
    expect(warnings).toEqual(['applications_invalid']);
    const aside = fs.readdirSync(dir).filter((f) => f.startsWith('applications.invalid-'));
    expect(aside).toHaveLength(1);
    expect(fs.readFileSync(path.join(dir, aside[0]), 'utf8')).toBe(original);
  });
});
