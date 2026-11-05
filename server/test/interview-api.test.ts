import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { InterviewPrep, InterviewPrepView } from '@bp/shared';
import { InterviewPrepStore } from '../src/interview/store.js';
import { AppError } from '../src/errors.js';
import { scriptedResponse } from '../src/llm/fake-scripted.js';
import type { LlmTask } from '../src/llm/types.js';
import { makeApp } from './helpers/app.js';
import { type Ctx, post, sendTo, setup } from './helpers/sending.js';

const url = (id: string, rest = '') => `/api/applications/${id}/interview${rest}`;
const LONG = 'Eine ausreichend lange und konkrete Antwort auf die Frage.';
const SECRET = 'GEHEIMTEXT-ANTWORT-4711';

const get = async (ctx: Ctx, id: string) => (await ctx.app.inject({ method: 'GET', url: url(id) })).json() as InterviewPrepView;
/** The page sends the createdAt of the set it shows; here that is the stored one (read raw: reading must not set a damaged file aside). */
const currentSet = (ctx: Ctx, id: string): string => {
  try { return (JSON.parse(fs.readFileSync(prepFile(ctx, id), 'utf8')) as { createdAt?: string }).createdAt ?? ''; } catch { return ''; }
};
const answer = (ctx: Ctx, id: string, qid: string, body: object = { text: LONG, dontKnow: false }) =>
  post(ctx, url(id, `/questions/${qid}/answer`), { setCreatedAt: currentSet(ctx, id), ...body });
const scripted = (ctx: Ctx) => { ctx.provider.respond = (task: LlmTask) => scriptedResponse(task); };
const prepFile = (ctx: Ctx, id: string) => path.join(ctx.dir, 'applications', id, 'interview-prep.json');
const store = (ctx: Ctx) => new InterviewPrepStore(path.join(ctx.dir, 'applications'));
const calls = (ctx: Ctx, taskId: string) => ctx.provider.calls.filter((c) => c.id === taskId).length;

/** A sent application with the scripted AI. */
async function sent(opts: Parameters<typeof setup>[0] = {}) {
  const r = await setup({ contact: true, ...opts });
  expect((await sendTo(r.ctx, r.id)).statusCode).toBe(200);
  scripted(r.ctx);
  return r;
}
async function started(opts: Parameters<typeof setup>[0] = {}) {
  const r = await sent(opts);
  expect((await post(r.ctx, url(r.id), { language: 'de' })).statusCode).toBe(200);
  return r;
}
async function allAnswered(ctx: Ctx, id: string, weak = 0) {
  const { prep } = await get(ctx, id);
  for (const [i, q] of prep!.questions.entries()) {
    expect((await answer(ctx, id, q.id, i < weak ? { text: 'kurz', dontKnow: false } : undefined)).statusCode).toBe(200);
  }
}
/** A respond() that stays open until the test lets it go. */
function held(ctx: Ctx) {
  const inner = ctx.provider.respond;
  let release = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const before = ctx.provider.calls.length;
  ctx.provider.respond = async (task, signal) => { await gate; return inner(task, signal); };
  const running = async () => { while (ctx.provider.calls.length === before) await new Promise((r) => setImmediate(r)); };
  return { release: () => release(), running };
}

afterEach(() => { vi.restoreAllMocks(); });

describe('interview preparation: starting', () => {
  it('sent: 9 questions in the order experience, theory, practice, with ids and 3 for the employer', async () => {
    const { ctx, id } = await sent();
    expect(await get(ctx, id)).toMatchObject({ prep: null, canStart: true, readOnly: false, defaultLanguage: 'de' });
    const r = await post(ctx, url(id), { language: 'de' });
    expect(r.statusCode).toBe(200);
    const { prep } = r.json() as InterviewPrepView;
    expect(prep!.questions.map((q) => q.id)).toEqual(['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8', 'q9']);
    expect(prep!.questions.map((q) => q.kind)).toEqual(['experience', 'experience', 'experience', 'experience', 'theory', 'theory', 'theory', 'theory', 'practice']);
    expect(prep!.employerQuestions).toHaveLength(3);
    expect(prep!.summary).toBeNull();
    expect(store(ctx).read(id)!.language).toBe('de');
  });

  it('the server puts the AI questions in order and clears code outside the practice task', async () => {
    const { ctx, id } = await sent();
    const q = (kind: string, code: string | null = null) => ({ kind, text: `Frage ${kind}`, code });
    ctx.provider.respond = () => ({
      questions: [q('practice', 'x()'), q('theory', 'wrong'), q('experience'), q('theory'), q('experience', 'wrong'), q('theory'), q('experience'), q('theory'), q('experience')],
      employerQuestions: ['A?', 'B?', 'C?'],
    });
    const { prep } = (await post(ctx, url(id), { language: 'de' })).json() as InterviewPrepView;
    expect(prep!.questions.map((x) => x.kind)).toEqual(['experience', 'experience', 'experience', 'experience', 'theory', 'theory', 'theory', 'theory', 'practice']);
    expect(prep!.questions.slice(0, 8).every((x) => x.code === null)).toBe(true);
    expect(prep!.questions[8].code).toBe('x()');
  });

  it('submitted and interview may start, a draft may not', async () => {
    const via = await setup({ contact: true });
    scripted(via.ctx);
    expect((await post(via.ctx, `/api/applications/${via.id}/submitted`, {})).statusCode).toBe(200);
    expect((await post(via.ctx, url(via.id), { language: 'en' })).statusCode).toBe(200);

    const meet = await sent();
    expect((await post(meet.ctx, `/api/applications/${meet.id}/status`, { status: 'interview', date: '2026-10-08' })).statusCode).toBe(200);
    expect((await post(meet.ctx, url(meet.id), { language: 'de' })).statusCode).toBe(200);

    const draft = await setup({ approve: false });
    scripted(draft.ctx);
    const r = await post(draft.ctx, url(draft.id), { language: 'de' });
    expect(r.statusCode).toBe(409);
    expect(r.json().error.reason).toBe('prepNotAvailable');
    expect(await get(draft.ctx, draft.id)).toMatchObject({ prep: null, canStart: false, readOnly: false });
  });

  it('rejected: a saved preparation can be read, nothing can be changed', async () => {
    const { ctx, id } = await started();
    expect((await post(ctx, `/api/applications/${id}/status`, { status: 'rejected', date: '2026-10-08' })).statusCode).toBe(200);
    expect(await get(ctx, id)).toMatchObject({ canStart: false, readOnly: true });
    expect((await get(ctx, id)).prep!.questions).toHaveLength(9);
    for (const r of [await post(ctx, url(id), { language: 'de', replace: true }), await answer(ctx, id, 'q1'), await post(ctx, url(id, '/summary'), {})]) {
      expect(r.statusCode).toBe(409);
      expect(r.json().error.reason).toBe('prepReadOnly');
    }
  });

  it('a second start needs replace: then a new set without a summary', async () => {
    const { ctx, id } = await started();
    await allAnswered(ctx, id);
    expect((await post(ctx, url(id, '/summary'), {})).statusCode).toBe(200);
    const r = await post(ctx, url(id), { language: 'de' });
    expect(r.statusCode).toBe(409);
    expect(r.json().error.reason).toBe('prepExists');
    expect((await get(ctx, id)).prep!.summary).not.toBeNull();
    const { prep } = (await post(ctx, url(id), { language: 'en', replace: true })).json() as InterviewPrepView;
    expect(prep!.language).toBe('en');
    expect(prep!.summary).toBeNull();
    expect(prep!.questions.every((q) => q.answer === null)).toBe(true);
  });

  it('the application was deleted while the AI wrote the set: a clean 404 and nothing comes back', async () => {
    const { ctx, id } = await sent();
    const gate = held(ctx);
    const pending = post(ctx, url(id), { language: 'de' });
    await gate.running();
    ctx.applicationStore.remove(id);
    gate.release();
    expect((await pending).statusCode).toBe(404);
    expect(fs.existsSync(path.join(ctx.dir, 'applications', id))).toBe(false);
  });

  it('a wrong set goes back to the AI once, then LLM_BAD_OUTPUT and nothing is written', async () => {
    const { ctx, id } = await sent();
    ctx.provider.respond = () => ({ questions: [{ kind: 'theory', text: 'Nur eine', code: null }], employerQuestions: ['A?'] });
    const r = await post(ctx, url(id), { language: 'de' });
    expect(r.statusCode).toBe(500);
    expect(r.json().error.code).toBe('LLM_BAD_OUTPUT');
    expect(calls(ctx, 'interview-questions')).toBe(2);
    expect(ctx.provider.calls[ctx.provider.calls.length - 1].prompt).toContain('previous answer broke these rules');
    expect(fs.existsSync(prepFile(ctx, id))).toBe(false);
  });

  it('no job ad text (unsolicited application): the set is still built', async () => {
    const { ctx, id } = await sent();
    fs.rmSync(path.join(ctx.dir, 'applications', id, 'vacancy.txt'), { force: true });
    fs.rmSync(path.join(ctx.dir, 'vacancies', 'texts', 'fav1.txt'), { force: true });
    const r = await post(ctx, url(id), { language: 'de' });
    expect(r.statusCode).toBe(200);
    expect(ctx.provider.calls[ctx.provider.calls.length - 1].prompt).toContain('No job ad text is available.');
  });

  it('bad language and unknown application', async () => {
    const { ctx, id } = await sent();
    expect((await post(ctx, url(id), { language: 'uk' })).statusCode).toBe(400);
    expect((await post(ctx, url('nope'), { language: 'de' })).statusCode).toBe(404);
    expect((await ctx.app.inject({ method: 'GET', url: url('nope') })).statusCode).toBe(404);
  });
});

describe('interview preparation: answering', () => {
  it('stores the feedback', async () => {
    const { ctx, id } = await started();
    const { prep } = (await answer(ctx, id, 'q1')).json() as InterviewPrepView;
    expect(prep!.questions[0].answer).toMatchObject({ text: LONG, dontKnow: false, feedback: { weak: false } });
    expect(store(ctx).read(id)!.questions[0].answer!.feedback).not.toBeNull();
    expect(prep!.questions[1].answer).toBeNull();
  });

  it('"I don\'t know" needs no text and is always weak, whatever the AI says', async () => {
    const { ctx, id } = await started();
    ctx.provider.respond = () => ({ weak: false, content: 'Gut.', languageFixes: [{ said: 'a', correct: 'b', why: 'c' }], better: 'So geht es.' });
    const r = await answer(ctx, id, 'q5', { text: '', dontKnow: true });
    expect(r.statusCode).toBe(200);
    const a = (r.json() as InterviewPrepView).prep!.questions[4].answer!;
    expect(a).toMatchObject({ text: '', dontKnow: true, feedback: { weak: true, languageFixes: [] } });
  });

  it('refuses an empty answer, a too long one and an unknown question', async () => {
    const { ctx, id } = await started();
    expect((await answer(ctx, id, 'q1', { text: '  ', dontKnow: false })).statusCode).toBe(400);
    expect((await answer(ctx, id, 'q1', { text: 'x'.repeat(5001), dontKnow: false })).statusCode).toBe(400);
    expect((await answer(ctx, id, 'q1', { text: 'x'.repeat(5000), dontKnow: false })).statusCode).toBe(200);
    expect((await answer(ctx, id, 'q99')).statusCode).toBe(404);
    expect(store(ctx).read(id)!.questions[1].answer).toBeNull();
  });

  it('an answer meant for another set is refused before anything is written or asked', async () => {
    const { ctx, id } = await started();
    const before = fs.readFileSync(prepFile(ctx, id));
    const n = ctx.provider.calls.length;
    const r = await answer(ctx, id, 'q3', { text: LONG, dontKnow: false, setCreatedAt: '2020-01-01T00:00:00.000Z' });
    expect(r.statusCode).toBe(409);
    expect(r.json().error.reason).toBe('packageChanged');
    expect(fs.readFileSync(prepFile(ctx, id)).equals(before)).toBe(true);
    expect(ctx.provider.calls.length).toBe(n);
    expect((await answer(ctx, id, 'q3')).statusCode).toBe(200);
  });

  it('no set yet: answering is 404', async () => {
    const { ctx, id } = await sent();
    expect((await answer(ctx, id, 'q1')).statusCode).toBe(404);
  });

  it('the AI fails on its limit: the answer stays without feedback and can be sent again', async () => {
    const { ctx, id } = await started();
    ctx.provider.respond = () => { throw new AppError('LLM_LIMIT', 'limit'); };
    const r = await answer(ctx, id, 'q1');
    expect(r.statusCode).toBe(429);
    expect(r.json().error.code).toBe('LLM_LIMIT');
    expect(store(ctx).read(id)!.questions[0].answer).toMatchObject({ text: LONG, feedback: null });
    scripted(ctx);
    const again = (await answer(ctx, id, 'q1')).json() as InterviewPrepView;
    expect(again.prep!.questions[0].answer!.feedback).not.toBeNull();
  });

  it('the set was replaced while the AI worked: packageChanged, the old feedback is not written', async () => {
    const { ctx, id } = await started();
    const gate = held(ctx);
    const pending = answer(ctx, id, 'q1');
    await gate.running();
    const now = store(ctx).read(id)!;
    const replaced: InterviewPrep = { ...now, createdAt: '2030-01-01T00:00:00.000Z', questions: now.questions.map((q) => ({ ...q, answer: null })) };
    store(ctx).write(replaced);
    gate.release();
    const r = await pending;
    expect(r.statusCode).toBe(409);
    expect(r.json().error.reason).toBe('packageChanged');
    expect(store(ctx).read(id)).toEqual(replaced);
  });

  it('the status changed while the AI worked: packageChanged, the feedback is not written, the answer stays', async () => {
    const { ctx, id } = await started();
    const gate = held(ctx);
    const pending = answer(ctx, id, 'q1');
    await gate.running();
    expect((await post(ctx, `/api/applications/${id}/status`, { status: 'rejected', date: '2026-10-08' })).statusCode).toBe(200);
    gate.release();
    const r = await pending;
    expect(r.json().error.reason).toBe('packageChanged');
    expect(store(ctx).read(id)!.questions[0].answer).toMatchObject({ text: LONG, feedback: null });
  });

  it('sent → interview while the AI worked keeps the result', async () => {
    const { ctx, id } = await started();
    const gate = held(ctx);
    const pending = answer(ctx, id, 'q1');
    await gate.running();
    expect((await post(ctx, `/api/applications/${id}/status`, { status: 'interview', date: '2026-10-08' })).statusCode).toBe(200);
    gate.release();
    expect((await pending).statusCode).toBe(200);
    expect(store(ctx).read(id)!.questions[0].answer!.feedback).not.toBeNull();
  });

  it('the application was deleted while the AI worked: a clean 404 and nothing comes back', async () => {
    const { ctx, id } = await started();
    const gate = held(ctx);
    const pending = answer(ctx, id, 'q1');
    await gate.running();
    ctx.applicationStore.remove(id);
    gate.release();
    expect((await pending).statusCode).toBe(404);
    expect(fs.existsSync(path.join(ctx.dir, 'applications', id))).toBe(false);
  });

  it('a second request on the same application while one runs: prepBusy', async () => {
    const { ctx, id } = await started();
    const gate = held(ctx);
    const pending = answer(ctx, id, 'q1');
    await gate.running();
    for (const r of [await answer(ctx, id, 'q2'), await post(ctx, url(id), { language: 'de', replace: true }), await post(ctx, url(id, '/summary'), {})]) {
      expect(r.statusCode).toBe(409);
      expect(r.json().error.reason).toBe('prepBusy');
    }
    gate.release();
    expect((await pending).statusCode).toBe(200);
    expect((await answer(ctx, id, 'q2')).statusCode).toBe(200);
  });

  it('the work is announced to `activity` only while it runs', async () => {
    const { ctx, id } = await started();
    const gate = held(ctx);
    const pending = answer(ctx, id, 'q1');
    await gate.running();
    expect(ctx.activity.active()).toContain('interview');
    gate.release();
    await pending;
    expect(ctx.activity.active()).not.toContain('interview');
  });

  it.each([['restore', 'restoreRunning'], ['update', 'updateRunning']])('during a %s nothing may start: %s', async (name, reason) => {
    const { ctx, id } = await started();
    const end = ctx.activity.begin(name);
    for (const r of [await post(ctx, url(id), { language: 'de', replace: true }), await answer(ctx, id, 'q1'), await post(ctx, url(id, '/summary'), {})]) {
      expect(r.statusCode).toBe(409);
      expect(r.json().error.reason).toBe(reason);
    }
    end();
  });
});

describe('interview preparation: summary', () => {
  it('before all answers have feedback: prepNotFinished', async () => {
    const { ctx, id } = await started();
    await answer(ctx, id, 'q1');
    const r = await post(ctx, url(id, '/summary'), {});
    expect(r.statusCode).toBe(409);
    expect(r.json().error.reason).toBe('prepNotFinished');
  });

  it('an answer without feedback also counts as not finished', async () => {
    const { ctx, id } = await started();
    await allAnswered(ctx, id);
    ctx.provider.respond = () => { throw new AppError('LLM_LIMIT', 'limit'); };
    await answer(ctx, id, 'q2');
    scripted(ctx);
    expect((await post(ctx, url(id, '/summary'), {})).json().error.reason).toBe('prepNotFinished');
  });

  it('4 weak of 9 and a raw 85 become 55', async () => {
    const { ctx, id } = await started();
    await allAnswered(ctx, id, 4);
    const inner = ctx.provider.respond;
    ctx.provider.respond = (task, signal) => ({ ...(inner(task, signal) as object), percent: 85 });
    const { prep } = (await post(ctx, url(id, '/summary'), {})).json() as InterviewPrepView;
    expect(prep!.summary).toMatchObject({ percent: 55, previousPercent: null, biggestRisk: { questionId: 'q1' } });
    expect(prep!.summary!.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('no changed answers: the AI is not asked again; a changed answer: new figure with the old one beside it', async () => {
    const { ctx, id } = await started();
    await allAnswered(ctx, id, 2);
    const first = ((await post(ctx, url(id, '/summary'), {})).json() as InterviewPrepView).prep!.summary!;
    expect(first.percent).toBe(70);
    const n = calls(ctx, 'interview-summary');
    const again = ((await post(ctx, url(id, '/summary'), {})).json() as InterviewPrepView).prep!.summary!;
    expect(again).toEqual(first);
    expect(calls(ctx, 'interview-summary')).toBe(n);

    expect((await answer(ctx, id, 'q1')).statusCode).toBe(200);
    // The old summary stays in the file as the source of previousPercent until a new one is made.
    expect(store(ctx).read(id)!.summary).toEqual(first);
    const next = ((await post(ctx, url(id, '/summary'), {})).json() as InterviewPrepView).prep!.summary!;
    expect(next).toMatchObject({ percent: 80, previousPercent: 70 });
    expect(next.fingerprint).not.toBe(first.fingerprint);
    expect(calls(ctx, 'interview-summary')).toBe(n + 1);
    expect(ctx.provider.calls[ctx.provider.calls.length - 1].prompt).toContain('The previous figure was 70%');
  });

  it('the view hides an outdated summary, the file keeps it for previousPercent', async () => {
    const { ctx, id } = await started();
    await allAnswered(ctx, id, 2);
    const first = ((await post(ctx, url(id, '/summary'), {})).json() as InterviewPrepView).prep!.summary!;
    const n = calls(ctx, 'interview-summary');

    // A changed answer: hidden.
    const changed = (await answer(ctx, id, 'q1')).json() as InterviewPrepView;
    expect(changed.prep!.summary).toBeNull();
    expect((await get(ctx, id)).prep!.summary).toBeNull();
    expect(store(ctx).read(id)!.summary).toEqual(first);

    // The recalculation fails: still hidden, the old one still in the file.
    ctx.provider.respond = () => { throw new AppError('LLM_LIMIT', 'limit'); };
    expect((await post(ctx, url(id, '/summary'), {})).statusCode).toBe(429);
    expect((await get(ctx, id)).prep!.summary).toBeNull();
    expect(store(ctx).read(id)!.summary).toEqual(first);

    // It succeeds: the new figure with the old one beside it.
    scripted(ctx);
    const next = ((await post(ctx, url(id, '/summary'), {})).json() as InterviewPrepView).prep!.summary!;
    expect(next).toMatchObject({ percent: 80, previousPercent: first.percent });
    expect((await get(ctx, id)).prep!.summary).toEqual(next);
    expect(calls(ctx, 'interview-summary')).toBe(n + 2);
  });

  it('an answer without feedback hides the summary even though its text is unchanged', async () => {
    const { ctx, id } = await started();
    await allAnswered(ctx, id);
    expect((await post(ctx, url(id, '/summary'), {})).statusCode).toBe(200);
    ctx.provider.respond = () => { throw new AppError('LLM_LIMIT', 'limit'); };
    await answer(ctx, id, 'q1');
    expect((await get(ctx, id)).prep!.summary).toBeNull();
  });

  it('the same text with the same verdict shows the summary again without asking the AI', async () => {
    const { ctx, id } = await started();
    await allAnswered(ctx, id, 2);
    const first = ((await post(ctx, url(id, '/summary'), {})).json() as InterviewPrepView).prep!.summary!;
    const n = calls(ctx, 'interview-summary');
    const same = (await answer(ctx, id, 'q9')).json() as InterviewPrepView;
    expect(same.prep!.summary).toEqual(first);
    expect(((await post(ctx, url(id, '/summary'), {})).json() as InterviewPrepView).prep!.summary).toEqual(first);
    expect(calls(ctx, 'interview-summary')).toBe(n);
  });

  it('the same text with a flipped verdict recalculates, and the figure obeys the new cap', async () => {
    const { ctx, id } = await started();
    await allAnswered(ctx, id);
    const first = ((await post(ctx, url(id, '/summary'), {})).json() as InterviewPrepView).prep!.summary!;
    expect(first.percent).toBe(90);
    const inner = ctx.provider.respond;
    ctx.provider.respond = (task, signal) => {
      const out = inner(task, signal) as Record<string, unknown>;
      return task.id === 'interview-feedback' ? { ...out, weak: true } : { ...out, percent: 95 };
    };
    for (const q of ['q1', 'q2', 'q3', 'q4']) expect((await answer(ctx, id, q)).statusCode).toBe(200);
    expect((await get(ctx, id)).prep!.summary).toBeNull();
    expect(((await post(ctx, url(id, '/summary'), {})).json() as InterviewPrepView).prep!.summary!.percent).toBe(55);
  });

  it('the set was replaced while the AI wrote the summary: packageChanged and no summary is written', async () => {
    const { ctx, id } = await started();
    await allAnswered(ctx, id);
    const gate = held(ctx);
    const pending = post(ctx, url(id, '/summary'), {});
    await gate.running();
    const now = store(ctx).read(id)!;
    const replaced: InterviewPrep = { ...now, createdAt: '2030-01-01T00:00:00.000Z' };
    store(ctx).write(replaced);
    gate.release();
    const r = await pending;
    expect(r.statusCode).toBe(409);
    expect(r.json().error.reason).toBe('packageChanged');
    expect(store(ctx).read(id)).toEqual(replaced);
  });

  it('a risk with an unknown question goes back once, then LLM_BAD_OUTPUT and the summary stays empty', async () => {
    const { ctx, id } = await started();
    await allAnswered(ctx, id);
    const note = 'Text.';
    ctx.provider.respond = () => ({ percent: 50, areas: { experience: note, theory: note, practice: note, language: note }, biggestRisk: { questionId: 'q77', why: note } });
    const r = await post(ctx, url(id, '/summary'), {});
    expect(r.json().error.code).toBe('LLM_BAD_OUTPUT');
    expect(calls(ctx, 'interview-summary')).toBe(2);
    expect(store(ctx).read(id)!.summary).toBeNull();
  });
});

describe('interview preparation: the frozen package, the log, broken files', () => {
  it('package.json is byte for byte the same after a whole run, and the log holds no texts', async () => {
    const lines: string[] = [];
    const push = (e: string, d?: unknown) => lines.push(JSON.stringify({ e, d }));
    const { ctx, id } = await sent({ logger: { info: push, warn: push, error: push } });
    const file = path.join(ctx.dir, 'applications', id, 'package.json');
    const before = fs.readFileSync(file);
    const inner = ctx.provider.respond;
    ctx.provider.respond = (task, signal) => {
      const out = inner(task, signal) as Record<string, unknown>;
      return task.id === 'interview-feedback' ? { ...out, content: 'GEHEIM-KI-INHALT', better: 'GEHEIM-KI-BESSER' } : out;
    };
    lines.length = 0;
    expect((await post(ctx, url(id), { language: 'de' })).statusCode).toBe(200);
    const { prep } = await get(ctx, id);
    for (const q of prep!.questions) expect((await answer(ctx, id, q.id, { text: `${SECRET} ${q.id}`, dontKnow: false })).statusCode).toBe(200);
    expect((await post(ctx, url(id, '/summary'), {})).statusCode).toBe(200);
    expect(fs.readFileSync(file).equals(before)).toBe(true);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join('\n')).not.toMatch(/GEHEIM/);
    for (const q of prep!.questions) expect(lines.join('\n')).not.toContain(q.text);
  });

  it('a damaged file is put aside: the page offers a new start, the server stays up', async () => {
    const { ctx, id } = await started();
    fs.writeFileSync(prepFile(ctx, id), '{ not json');
    expect(await get(ctx, id)).toMatchObject({ prep: null, canStart: true });
    expect(fs.readdirSync(path.dirname(prepFile(ctx, id))).some((f) => f.startsWith('interview-prep.corrupt-'))).toBe(true);
  });

  it('a file that cannot be read gives a clean error and the server keeps answering', async () => {
    const { ctx, id } = await sent();
    fs.mkdirSync(prepFile(ctx, id)); // reading a folder fails with EISDIR
    const dirInJson = JSON.stringify(ctx.dir).slice(1, -1);
    for (const r of [await ctx.app.inject({ method: 'GET', url: url(id) }), await post(ctx, url(id), { language: 'de' }), await answer(ctx, id, 'q1'), await post(ctx, url(id, '/summary'), {})]) {
      expect(r.statusCode).toBe(409);
      expect(r.json().error).toMatchObject({ code: 'CONFLICT', reason: 'prepUnreadable' });
      expect(r.body).not.toContain(dirInJson);
    }
    expect((await ctx.app.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200);
    expect(ctx.activity.active()).toEqual([]);
  });

  it('a file from a newer version stays where it is, byte for byte, and every route answers prepUnreadable', async () => {
    const { ctx, id } = await started();
    const newer = JSON.stringify({ ...JSON.parse(fs.readFileSync(prepFile(ctx, id), 'utf8')), schemaVersion: 999 });
    fs.writeFileSync(prepFile(ctx, id), newer);
    const calls0 = ctx.provider.calls.length;
    for (const r of [await ctx.app.inject({ method: 'GET', url: url(id) }), await post(ctx, url(id), { language: 'de', replace: true }), await answer(ctx, id, 'q1'), await post(ctx, url(id, '/summary'), {})]) {
      expect(r.statusCode).toBe(409);
      expect(r.json().error).toMatchObject({ code: 'CONFLICT', reason: 'prepUnreadable' });
    }
    expect(fs.readFileSync(prepFile(ctx, id), 'utf8')).toBe(newer);
    expect(fs.readdirSync(path.dirname(prepFile(ctx, id))).filter((f) => f.startsWith('interview-prep.'))).toEqual(['interview-prep.json']);
    expect(ctx.provider.calls.length).toBe(calls0);
  });

  it('a damaged file that cannot be put aside gives the same clean error', async () => {
    const { ctx, id } = await started();
    fs.writeFileSync(prepFile(ctx, id), '{ not json');
    vi.spyOn(fs, 'renameSync').mockImplementation(() => { throw Object.assign(new Error('busy'), { code: 'EBUSY' }); });
    const r = await ctx.app.inject({ method: 'GET', url: url(id) });
    expect(r.statusCode).toBe(409);
    expect(r.json().error.reason).toBe('prepUnreadable');
  });
});

describe('interview preparation: the launch key', () => {
  it('every route stays closed without it', async () => {
    const ctx = await makeApp({ autoKey: false });
    const client = { 'x-bp-client': '1' };
    const results = await Promise.all([
      ctx.app.inject({ method: 'GET', url: url('a1') }),
      ctx.app.inject({ method: 'POST', url: url('a1'), headers: client, payload: { language: 'de' } }),
      ctx.app.inject({ method: 'POST', url: url('a1', '/questions/q1/answer'), headers: client, payload: { text: 'x', dontKnow: false } }),
      ctx.app.inject({ method: 'POST', url: url('a1', '/summary'), headers: client, payload: {} }),
    ]);
    expect(results.map((r) => r.statusCode)).toEqual([401, 401, 401, 401]);
  });
});
