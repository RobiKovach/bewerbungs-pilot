import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { followUpDue, followUpOpen } from '../src/applications/follow-up.js';
import { SentUnsavedLog } from '../src/applications/sent-unsaved.js';
import { pkg } from './helpers/applications.js';

const DAY = 86_400_000;
const SENT = '2026-10-01T12:00:00.000Z';
const at = (days: number, hours = 0) => new Date(Date.parse(SENT) + days * DAY + hours * 3_600_000);
const sent = (over = {}) => pkg({ status: 'sent', history: [{ kind: 'approved', at: '2026-09-30T12:00:00.000Z' }, { kind: 'sent', at: SENT, to: 'jobs@muster.example', messageId: '<m1@x>' }], ...over });

describe('reminder due', () => {
  it('appears after exactly 14 days, not at 13 days 23 hours', () => {
    expect(followUpDue(sent(), at(13, 23))).toBe(false);
    expect(followUpDue(sent(), at(14))).toBe(true);
  });
  it('works the same for "submitted"', () => {
    const p = pkg({ status: 'submitted', history: [{ kind: 'submitted', at: SENT }] });
    expect(followUpDue(p, at(20))).toBe(true);
  });
  it('is gone after a reminder or "do not remind" and never comes back', () => {
    for (const kind of ['followUp', 'followUpDismissed'] as const) {
      const p = sent();
      p.history.push({ kind, at: at(15).toISOString() });
      expect(followUpDue(p, at(40))).toBe(false);
      expect(followUpOpen(p)).toBe(false);
    }
  });
  it('a later status (interview) or a draft never asks for a reminder', () => {
    const p = sent();
    p.history.push({ kind: 'interview', at: at(3).toISOString() });
    p.status = 'interview';
    expect(followUpDue(p, at(30))).toBe(false);
    expect(followUpDue(pkg({ status: 'approved' }), at(30))).toBe(false);
  });
});

describe('SentUnsavedLog', () => {
  const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bp su-')), 'sent-unsaved.json');
  it('keys survive a restart (a new instance on the same file)', () => {
    const file = tmp();
    new SentUnsavedLog(file).add('a1');
    const again = new SentUnsavedLog(file);
    again.load();
    expect(again.has('a1')).toBe(true);
    expect(again.has('a2')).toBe(false);
  });
  it('a broken file is a warning, not a crash', () => {
    const file = tmp();
    fs.writeFileSync(file, 'not json');
    const warns: string[] = [];
    const log = new SentUnsavedLog(file, (event) => warns.push(event));
    expect(() => log.load()).not.toThrow();
    expect(log.has('a1')).toBe(false);
    expect(warns).toEqual(['sent_unsaved_unreadable']);
  });
  it('a wrong shape is also ignored', () => {
    const file = tmp();
    fs.writeFileSync(file, JSON.stringify({ keys: 5 }));
    const warns: string[] = [];
    const log = new SentUnsavedLog(file, (event) => warns.push(event));
    log.load();
    expect(log.has('a1')).toBe(false);
    expect(warns).toHaveLength(1);
  });
  it('a missing file is simply empty', () => {
    const warns: string[] = [];
    const log = new SentUnsavedLog(tmp(), (event) => warns.push(event));
    log.load();
    expect(log.has('a1')).toBe(false);
    expect(warns).toEqual([]);
  });
  it('without a file the keys live in memory only', () => {
    const log = new SentUnsavedLog(null);
    log.add('a1');
    expect(log.has('a1')).toBe(true);
  });
  it('a failed write only warns and the key still counts', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp su-'));
    // The "file" is an existing folder, so the atomic rename onto it fails.
    const file = path.join(dir, 'sent-unsaved.json');
    fs.mkdirSync(file);
    fs.writeFileSync(path.join(file, 'x'), 'x');
    const warns: string[] = [];
    const log = new SentUnsavedLog(file, (event) => warns.push(event));
    expect(() => log.add('a1')).not.toThrow();
    expect(log.has('a1')).toBe(true);
    expect(warns).toEqual(['sent_unsaved_write_failed']);
  });
});
