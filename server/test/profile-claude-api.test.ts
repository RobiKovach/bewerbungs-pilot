import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { AppError } from '../src/errors.js';
import { H, makeApp } from './helpers/app.js';
import { makeDocx, multipartBody, PDF_BYTES } from './helpers/files.js';
import { SAMPLE_CV, scriptedClaude } from './helpers/profile.js';

type App = Awaited<ReturnType<typeof makeApp>>['app'];
const uploadCv = (app: App, name: string, bytes: Buffer) => app.inject({ method: 'POST', url: '/api/profile/cv', ...multipartBody(name, bytes) });
const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));
const CV_SECTIONS = ['personal', 'education', 'experience', 'skills', 'languages'];

describe('POST /api/profile/cv', () => {
  it('reads a PDF CV: sections filled and marked, wizard moves on, Claude gets only a copy by generated name', async () => {
    const { app, provider, filesDir } = await makeApp({ provider: scriptedClaude({ cv: SAMPLE_CV }) });
    const res = await uploadCv(app, 'Lebenslauf Max.pdf', PDF_BYTES);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.changedSections).toEqual(CV_SECTIONS);
    expect(body.profile.sections.personal.data).toMatchObject({ fullName: 'Max Mustermann', birthDate: '1990-03-15' });
    expect(body.profile.sections.personal.aiFields).toContain('fullName');
    expect(body.profile.sections.personal.confirmedAt).toBeNull();
    expect(body.profile.sections.wishes.aiFields).toEqual([]);
    expect(body.profile.wizard.step).toBe(2);
    expect(body.profile.cv).toMatchObject({ ext: '.pdf', originalName: 'Lebenslauf Max.pdf' });
    const task = provider.calls[0];
    expect(task.files).toEqual([path.join(filesDir, `${body.profile.cv.id}.pdf`)]);
    expect(task.prompt).not.toContain('Lebenslauf Max');
    expect(task.replyLanguage).toBe('en');
  });

  it('sends DOCX text fenced, not the file', async () => {
    const { app, provider } = await makeApp({ provider: scriptedClaude({ cv: SAMPLE_CV }) });
    const res = await uploadCv(app, 'cv.docx', makeDocx(['Max Mustermann', 'Webentwickler bei Beispiel GmbH seit 2018']));
    expect(res.statusCode).toBe(200);
    expect(provider.calls[0].files).toBeUndefined();
    expect(provider.calls[0].prompt).toMatch(/<<<UNTRUSTED_CV_[0-9a-f]{16}>>>[\s\S]*Webentwickler bei Beispiel GmbH/);
  });

  it('refuses a DOCX without text before asking Claude, and keeps nothing', async () => {
    const { app, provider, filesDir, profileStore } = await makeApp({ provider: scriptedClaude({ cv: SAMPLE_CV }) });
    const res = await uploadCv(app, 'scan.docx', makeDocx(['']));
    expect(res.statusCode).toBe(422);
    const error = res.json().error;
    expect(error.code).toBe('CV_UNREADABLE');
    // The person-facing "Details" must carry a translatable reason, not just the raw English log line.
    expect(error.reason).toBe('cvTooLittleText');
    expect(error.params).toEqual({ chars: 0 });
    expect(provider.calls).toHaveLength(0);
    expect(fs.readdirSync(filesDir)).toEqual([]);
    expect(profileStore.get().cv).toBeNull();
  });

  it('reports CV_UNREADABLE when Claude finds no CV, and keeps nothing', async () => {
    const { app, filesDir, profileStore } = await makeApp({ provider: scriptedClaude({ cv: { ...SAMPLE_CV, readable: false } }) });
    const res = await uploadCv(app, 'holiday.pdf', PDF_BYTES);
    expect(res.statusCode).toBe(422);
    expect(fs.readdirSync(filesDir)).toEqual([]);
    expect(profileStore.get().sections.personal.data.fullName).toBe('');
  });

  it('passes Claude errors on and deletes the upload', async () => {
    const { app, filesDir } = await makeApp({ provider: scriptedClaude({ cv: () => { throw new AppError('LLM_TIMEOUT', 'slow'); } }) });
    const res = await uploadCv(app, 'cv.pdf', PDF_BYTES);
    expect(res.statusCode).toBe(504);
    expect(fs.readdirSync(filesDir)).toEqual([]);
  });

  it('a replaced CV resets only the sections it changed; stories and the old file are handled', async () => {
    let cv = SAMPLE_CV;
    const { app, filesDir } = await makeApp({ provider: scriptedClaude({ cv: () => cv }) });
    const first = (await uploadCv(app, 'cv1.pdf', PDF_BYTES)).json();
    await app.inject({ method: 'POST', url: '/api/profile/sections/personal/confirm', headers: H, payload: {} });
    await app.inject({ method: 'POST', url: '/api/profile/stories', headers: H, payload: { title: 'T', text: 'X', kind: 'work', disclosure: 'ok' } });
    cv = { ...SAMPLE_CV, experience: [...SAMPLE_CV.experience, { jobTitle: 'Teamleiter', employer: 'Neu AG', city: '', country: '', from: '2023', to: '', description: '' }] };
    const second = (await uploadCv(app, 'cv2.pdf', PDF_BYTES)).json();
    expect(second.changedSections).toEqual(['experience']);
    expect(second.profile.sections.personal.confirmedAt).not.toBeNull();
    expect(second.profile.sections.experience.confirmedAt).toBeNull();
    expect(second.profile.stories).toHaveLength(1);
    expect(fs.readdirSync(filesDir)).toEqual([`${second.profile.cv.id}.pdf`]);
    expect(second.profile.cv.id).not.toBe(first.profile.cv.id);
  });

  it('a new CV never overwrites a section the person worked on: it becomes a proposal they decide on', async () => {
    let cv = SAMPLE_CV;
    const { app } = await makeApp({ provider: scriptedClaude({ cv: () => cv }) });
    const first = (await uploadCv(app, 'cv1.pdf', PDF_BYTES)).json();
    expect(first.proposedSections).toEqual([]);
    // personal: confirmed. skills: one field edited by hand. experience/education/languages: untouched.
    await app.inject({ method: 'POST', url: '/api/profile/sections/personal/confirm', headers: H, payload: {} });
    const skills = first.profile.sections.skills.data;
    skills.items[0].level = 'expert';
    await app.inject({ method: 'PUT', url: '/api/profile/sections/skills', headers: H, payload: { data: skills } });
    const before = (await app.inject({ method: 'GET', url: '/api/profile' })).json().profile;

    cv = {
      ...SAMPLE_CV,
      personal: { ...SAMPLE_CV.personal, city: 'Dresden' },
      skills: [...SAMPLE_CV.skills, { name: 'TypeScript', level: 'good' }],
      experience: [...SAMPLE_CV.experience, { jobTitle: 'Teamleiter', employer: 'Neu AG', city: '', country: '', from: '2023', to: '', description: '' }],
    };
    const second = (await uploadCv(app, 'cv2.pdf', PDF_BYTES)).json();
    expect(second.changedSections).toEqual(['experience']);
    expect(second.proposedSections).toEqual(['personal', 'skills']);
    expect(second.profile.sections.personal).toEqual(before.sections.personal);
    expect(second.profile.sections.skills).toEqual(before.sections.skills);
    expect(second.profile.cvProposals.personal.city).toBe('Dresden');
    expect(second.profile.cvProposals.skills.items.map((s: { name: string }) => s.name)).toEqual(['JavaScript', 'WordPress', 'TypeScript']);
    expect(second.profile.cvProposals.experience).toBeUndefined();
    expect(second.profile.sections.experience.data.items).toHaveLength(2);

    // Editing and confirming does not decide for the person: the proposal stays.
    await app.inject({ method: 'POST', url: '/api/profile/sections/skills/confirm', headers: H, payload: {} });
    expect((await app.inject({ method: 'GET', url: '/api/profile' })).json().profile.cvProposals.skills).toBeDefined();

    const taken = await app.inject({ method: 'POST', url: '/api/profile/sections/personal/proposal/accept', headers: H, payload: {} });
    expect(taken.statusCode).toBe(200);
    const personal = taken.json().profile.sections.personal;
    expect(personal.data).toEqual(second.profile.cvProposals.personal);
    expect(personal.confirmedAt).toBeNull();
    expect(personal.aiFields).toEqual(expect.arrayContaining(['fullName', 'city']));
    expect(taken.json().profile.cvProposals.personal).toBeUndefined();

    const kept = await app.inject({ method: 'POST', url: '/api/profile/sections/skills/proposal/reject', headers: H, payload: {} });
    expect(kept.statusCode).toBe(200);
    expect(kept.json().profile.sections.skills.data).toEqual(before.sections.skills.data);
    expect(kept.json().profile.sections.skills.confirmedAt).not.toBeNull();
    expect(kept.json().profile.cvProposals).toEqual({});
  });

  it('a later CV replaces or removes an open proposal; proposals do not block readiness', async () => {
    let cv = SAMPLE_CV;
    const { app } = await makeApp({ provider: scriptedClaude({ cv: () => cv }) });
    await uploadCv(app, 'cv1.pdf', PDF_BYTES);
    for (const id of ['personal', 'education', 'experience', 'skills', 'languages', 'wishes']) {
      await app.inject({ method: 'POST', url: `/api/profile/sections/${id}/confirm`, headers: H, payload: {} });
    }
    cv = { ...SAMPLE_CV, personal: { ...SAMPLE_CV.personal, city: 'Dresden' } };
    const second = (await uploadCv(app, 'cv2.pdf', PDF_BYTES)).json();
    expect(second.proposedSections).toEqual(['personal']);
    expect(second.readiness.ready).toBe(true);
    cv = { ...SAMPLE_CV, personal: { ...SAMPLE_CV.personal, city: 'Leipzig' } };
    const third = (await uploadCv(app, 'cv3.pdf', PDF_BYTES)).json();
    expect(third.proposedSections).toEqual(['personal']);
    expect(third.profile.cvProposals.personal.city).toBe('Leipzig');
    cv = SAMPLE_CV;
    const fourth = (await uploadCv(app, 'cv4.pdf', PDF_BYTES)).json();
    expect(fourth.proposedSections).toEqual([]);
    expect(fourth.changedSections).toEqual([]);
    expect(fourth.profile.cvProposals).toEqual({});
    expect(fourth.profile.sections.personal.confirmedAt).not.toBeNull();
  });

  it('answers NOT_FOUND when there is nothing to decide, and needs the client header', async () => {
    const { app } = await makeApp({ provider: scriptedClaude({ cv: SAMPLE_CV }) });
    for (const url of [
      '/api/profile/sections/personal/proposal/accept', '/api/profile/sections/personal/proposal/reject',
      '/api/profile/sections/wishes/proposal/accept', '/api/profile/sections/nope/proposal/reject',
    ]) {
      const res = await app.inject({ method: 'POST', url, headers: H, payload: {} });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('NOT_FOUND');
    }
    const noHeader = await app.inject({ method: 'POST', url: '/api/profile/sections/personal/proposal/accept', payload: {} });
    expect(noHeader.statusCode).toBe(403);
  });

  it('keeps the new CV even when deleting the old one fails', async () => {
    let cv = SAMPLE_CV;
    const { app, filesDir, profileFiles } = await makeApp({ provider: scriptedClaude({ cv: () => cv }) });
    const first = (await uploadCv(app, 'cv1.pdf', PDF_BYTES)).json();
    const oldId = first.profile.cv.id;
    const spy = vi.spyOn(profileFiles, 'remove').mockImplementation((file) => {
      if (file.id === oldId) throw new Error('simulated Windows file lock');
    });
    cv = { ...SAMPLE_CV, experience: [...SAMPLE_CV.experience, { jobTitle: 'Teamleiter', employer: 'Neu AG', city: '', country: '', from: '2023', to: '', description: '' }] };
    const res = await uploadCv(app, 'cv2.pdf', PDF_BYTES);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.profile.cv.id).not.toBe(oldId);
    expect(fs.existsSync(path.join(filesDir, `${body.profile.cv.id}.pdf`))).toBe(true);
    spy.mockRestore();
  });

  it('keeps an edit the person made while Claude was reading', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const { app, provider, profileStore } = await makeApp({ provider: scriptedClaude({ cv: async () => { await gate; return SAMPLE_CV; } }) });
    const pending = uploadCv(app, 'cv.pdf', PDF_BYTES);
    while (provider.calls.length === 0) await tick();
    const wishes = { ...profileStore.get().sections.wishes.data, jobTitles: ['Webentwickler'] };
    const edit = await app.inject({ method: 'PUT', url: '/api/profile/sections/wishes', headers: H, payload: { data: wishes } });
    expect(edit.statusCode).toBe(200);
    release();
    const res = await pending;
    expect(res.statusCode).toBe(200);
    expect(res.json().profile.sections.wishes.data.jobTitles).toEqual(['Webentwickler']);
    expect(res.json().profile.sections.personal.data.fullName).toBe('Max Mustermann');
  });

  it('stops Claude and keeps nothing when the person cancels', async () => {
    let aborted = false;
    const provider = scriptedClaude({
      cv: (_t: unknown, signal: AbortSignal) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => { aborted = true; reject(new AppError('LLM_CANCELLED', 'test')); });
      }),
    });
    let port = 0;
    const { app, filesDir, profileStore } = await makeApp({ provider, allowedHosts: () => [`127.0.0.1:${port}`] });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const addr = app.server.address();
    if (!addr || typeof addr === 'string') throw new Error('expected a network address');
    port = addr.port;
    const { payload, headers } = multipartBody('cv.pdf', PDF_BYTES);
    await new Promise<void>((resolve) => {
      const req = http.request({ host: '127.0.0.1', port, path: '/api/profile/cv', method: 'POST', headers });
      req.on('error', () => { /* expected: we destroy the socket ourselves */ });
      req.end(payload);
      setTimeout(() => { req.destroy(); resolve(); }, 150);
    });
    await tick(100);
    expect(aborted).toBe(true);
    expect(fs.readdirSync(filesDir)).toEqual([]);
    expect(profileStore.get().cv).toBeNull();
    await app.close();
  });
});

describe('follow-up questions and stories', () => {
  const QUESTIONS = { questions: [
    { question: 'What project are you proud of?', why: 'Stories beat lists.' },
    { question: 'Who was it for?', why: 'Clients matter.' },
    { question: 'Anything we must never mention?', why: 'Your limits.' },
  ] };

  it('stores the questions Claude asked', async () => {
    const { app, provider } = await makeApp({ provider: scriptedClaude({ questions: QUESTIONS }) });
    const res = await app.inject({ method: 'POST', url: '/api/profile/followups', headers: H, payload: {} });
    expect(res.statusCode).toBe(200);
    expect(res.json().profile.pendingQuestions.map((q: { question: string }) => q.question)).toEqual(QUESTIONS.questions.map((q) => q.question));
    expect(provider.calls[0].prompt).toMatch(/<<<UNTRUSTED_PROFILE_/);
  });

  it('turns answers into unconfirmed stories and forgets the questions', async () => {
    const provider = scriptedClaude({
      questions: QUESTIONS,
      stories: { stories: [{ title: 'Bakery website', text: 'I built a website for a small bakery.', kind: 'client', disclosure: 'ok' }] },
    });
    const { app } = await makeApp({ provider });
    await app.inject({ method: 'PUT', url: '/api/profile/never-mention', headers: H, payload: ['Kunde X'] });
    const asked = (await app.inject({ method: 'POST', url: '/api/profile/followups', headers: H, payload: {} })).json();
    const [q1, q2] = asked.profile.pendingQuestions;
    const res = await app.inject({
      method: 'POST', url: '/api/profile/stories/structure', headers: H,
      payload: { answers: [{ questionId: q1.id, answer: 'A website for a bakery' }, { questionId: q2.id, answer: '   ' }] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().profile.stories).toEqual([expect.objectContaining({ title: 'Bakery website', confirmed: false })]);
    expect(res.json().profile.pendingQuestions).toEqual([]);
    const prompt = provider.calls[1].prompt;
    expect(prompt).toContain('A website for a bakery');
    expect(prompt).not.toContain('Who was it for?');
    expect(prompt).toMatch(/<<<UNTRUSTED_NEVER_MENTION_[0-9a-f]{16}>>>[\s\S]*Kunde X/);
  });

  it('refuses unknown questions and empty answers without calling Claude', async () => {
    const provider = scriptedClaude({ questions: QUESTIONS, stories: { stories: [] } });
    const { app } = await makeApp({ provider });
    const q = (await app.inject({ method: 'POST', url: '/api/profile/followups', headers: H, payload: {} })).json().profile.pendingQuestions[0];
    const unknown = await app.inject({ method: 'POST', url: '/api/profile/stories/structure', headers: H, payload: { answers: [{ questionId: 'nope', answer: 'x' }] } });
    expect(unknown.statusCode).toBe(400);
    const empty = await app.inject({ method: 'POST', url: '/api/profile/stories/structure', headers: H, payload: { answers: [{ questionId: q.id, answer: '' }] } });
    expect(empty.statusCode).toBe(400);
    expect(provider.calls).toHaveLength(1);
  });

  it('skips the pending questions without creating stories or calling Claude again', async () => {
    const provider = scriptedClaude({ questions: QUESTIONS });
    const { app } = await makeApp({ provider });
    await app.inject({ method: 'POST', url: '/api/profile/followups', headers: H, payload: {} });
    const res = await app.inject({ method: 'DELETE', url: '/api/profile/followups', headers: H });
    expect(res.statusCode).toBe(200);
    expect(res.json().profile.pendingQuestions).toEqual([]);
    expect(res.json().profile.stories).toEqual([]);
    expect(provider.calls).toHaveLength(1);
    const noHeader = await app.inject({ method: 'DELETE', url: '/api/profile/followups' });
    expect(noHeader.statusCode).toBe(403);
  });

  it('reading the profile never calls Claude', async () => {
    const { app, provider } = await makeApp({ provider: scriptedClaude({}) });
    await app.inject({ method: 'GET', url: '/api/profile' });
    expect(provider.calls).toHaveLength(0);
  });
});
