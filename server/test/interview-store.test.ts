import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import type { InterviewPrep } from '@bp/shared';
import { AppError } from '../src/errors.js';
import { InterviewPrepStore } from '../src/interview/store.js';

const ID = 'app-1';
const SECRET = 'Mein geheimer Antworttext';

function setup() {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bp prep Дані-')), 'applications');
  fs.mkdirSync(path.join(dir, ID), { recursive: true });
  const warnings: { event: string; data: Record<string, unknown> }[] = [];
  const store = new InterviewPrepStore(dir, (event, data) => warnings.push({ event, data }));
  return { dir, store, warnings, file: path.join(dir, ID, 'interview-prep.json') };
}

function prep(over: Partial<InterviewPrep> = {}): InterviewPrep {
  const at = '2026-11-04T10:00:00.000Z';
  return {
    schemaVersion: 1, applicationId: ID, language: 'de', createdAt: at, updatedAt: at,
    questions: [
      {
        id: 'q1', kind: 'experience', text: 'Erzählen Sie etwas über sich', code: null,
        answer: {
          text: SECRET, dontKnow: false, updatedAt: at,
          feedback: { weak: true, content: 'Zu allgemein', languageFixes: [{ said: 'a', correct: 'b', why: 'c' }], better: 'Besser so' },
        },
      },
      { id: 'q2', kind: 'practice', text: 'Wo ist der Fehler?', code: 'return a + b;', answer: null },
    ],
    employerQuestions: ['Wie sieht das Team aus?'],
    summary: {
      percent: 60, previousPercent: null,
      areas: { experience: 'gut', theory: 'schwach', practice: 'ok', language: 'ok' },
      biggestRisk: { questionId: 'q2', why: 'Fehler nicht gefunden' },
      fingerprint: 'a'.repeat(64), createdAt: at,
    },
    ...over,
  };
}

const setAside = (dir: string, kind: string) => fs.readdirSync(path.join(dir, ID)).filter((f) => new RegExp(`^interview-prep\\.${kind}-\\d+\\.json$`).test(f));

describe('InterviewPrepStore', () => {
  it('writes and reads a prep, without a temp file left behind', () => {
    const { store, dir } = setup();
    store.write(prep());
    expect(store.read(ID)).toEqual(prep());
    expect(fs.readdirSync(path.join(dir, ID))).toEqual(['interview-prep.json']);
  });

  it('reads the file every time, so a restored backup is seen at once', () => {
    const { store, file } = setup();
    store.write(prep());
    fs.writeFileSync(file, JSON.stringify(prep({ language: 'en' })));
    expect(store.read(ID)?.language).toBe('en');
  });

  it('no file → null, nothing set aside', () => {
    const { store, warnings, dir } = setup();
    expect(store.read(ID)).toBeNull();
    expect(warnings).toEqual([]);
    expect(fs.readdirSync(path.join(dir, ID))).toEqual([]);
  });

  it('not JSON → put aside as corrupt, null, the warning has no content', () => {
    const { store, dir, file, warnings } = setup();
    fs.writeFileSync(file, `{ "text": "${SECRET}"`);
    expect(store.read(ID)).toBeNull();
    expect(fs.existsSync(file)).toBe(false);
    expect(setAside(dir, 'corrupt')).toHaveLength(1);
    expect(warnings).toHaveLength(1);
    expect(JSON.stringify(warnings)).not.toContain(SECRET);
    expect(store.read(ID)).toBeNull();
    expect(warnings).toHaveLength(1);
  });

  it.each([
    ['another schema version', { schemaVersion: 2 }],
    ['another application', { applicationId: 'app-2' }],
    ['a wrong shape', { questions: 'nope' }],
  ])('%s → put aside, null, the warning has no content', (_name, over) => {
    const { store, dir, file, warnings } = setup();
    fs.writeFileSync(file, JSON.stringify({ ...prep(), ...over }));
    expect(store.read(ID)).toBeNull();
    expect(fs.existsSync(file)).toBe(false);
    expect(setAside(dir, 'invalid')).toHaveLength(1);
    expect(warnings).toHaveLength(1);
    expect(JSON.stringify(warnings)).not.toContain(SECRET);
  });

  it('valid JSON that is not an object → put aside, null', () => {
    const { store, dir, file } = setup();
    fs.writeFileSync(file, 'null');
    expect(store.read(ID)).toBeNull();
    fs.writeFileSync(file, '[1]');
    expect(store.read(ID)).toBeNull();
    expect(setAside(dir, 'invalid').length).toBeGreaterThan(0);
  });

  it('an unsafe id is BAD_REQUEST and touches nothing outside', () => {
    const { store, dir } = setup();
    const code = (fn: () => unknown) => {
      try {
        fn();
        return 'ok';
      } catch (err) {
        return err instanceof AppError ? err.code : String(err);
      }
    };
    expect(code(() => store.read('..\\x'))).toBe('BAD_REQUEST');
    expect(code(() => store.read('../x'))).toBe('BAD_REQUEST');
    expect(code(() => store.write(prep({ applicationId: '..\\x' })))).toBe('BAD_REQUEST');
    expect(fs.existsSync(path.join(path.dirname(dir), 'x'))).toBe(false);
  });

  it('refuses to write an invalid prep, the old file stays', () => {
    const { store } = setup();
    store.write(prep());
    const broken = { ...prep(), questions: 'nope' } as unknown as InterviewPrep;
    expect(() => store.write(broken)).toThrowError(expect.objectContaining({ code: 'BAD_REQUEST' }));
    expect(store.read(ID)).toEqual(prep());
  });

  it('a failed write is DATA_WRITE_FAILED: a removed application does not come back', () => {
    const { store, dir } = setup();
    fs.rmSync(path.join(dir, ID), { recursive: true });
    expect(() => store.write(prep())).toThrowError(expect.objectContaining({ code: 'DATA_WRITE_FAILED' }));
    expect(fs.existsSync(path.join(dir, ID))).toBe(false);
  });
});
