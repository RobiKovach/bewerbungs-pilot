import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { H, makeApp } from './helpers/app.js';

describe('profile API', () => {
  it('returns the empty profile with readiness, without writing anything', async () => {
    const { app, profileFile } = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/profile' });
    expect(res.statusCode).toBe(200);
    expect(res.json().readiness).toEqual({
      ready: false, missing: ['personal', 'education', 'experience', 'skills', 'languages', 'wishes'], warnings: ['noStories'],
    });
    expect(res.json().profile.wizard).toEqual({ step: 1, completedAt: null });
    expect(fs.existsSync(profileFile)).toBe(false);
  });

  it('saves a section: AI marks go only from changed fields, the confirmation stays', async () => {
    const { app, profileStore } = await makeApp();
    profileStore.update((p) => {
      p.sections.personal.data.fullName = 'Max Mustermann';
      p.sections.personal.data.city = 'Berlin';
      p.sections.personal.aiFields = ['fullName', 'city'];
      p.sections.personal.confirmedAt = '2026-09-24T10:00:00.000Z';
    });
    const data = { ...profileStore.get().sections.personal.data, city: 'Dresden' };
    const res = await app.inject({ method: 'PUT', url: '/api/profile/sections/personal', headers: H, payload: { data } });
    expect(res.statusCode).toBe(200);
    expect(res.json().profile.sections.personal).toEqual({ data, aiFields: ['fullName'], confirmedAt: '2026-09-24T10:00:00.000Z', editedAt: expect.any(String) });
    expect(profileStore.get().sections.personal.data.city).toBe('Dresden');
  });

  it('refuses invalid section data and unknown sections', async () => {
    const { app } = await makeApp();
    const bad = await app.inject({ method: 'PUT', url: '/api/profile/sections/experience', headers: H, payload: { data: { items: [{ id: 'a' }] } } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('BAD_REQUEST');
    const unknown = await app.inject({ method: 'PUT', url: '/api/profile/sections/hobbies', headers: H, payload: { data: {} } });
    expect(unknown.statusCode).toBe(404);
  });

  it('needs the client header for changes', async () => {
    const { app } = await makeApp();
    const res = await app.inject({ method: 'POST', url: '/api/profile/sections/skills/confirm', payload: {} });
    expect(res.statusCode).toBe(403);
  });

  it('is ready once all six sections are confirmed', async () => {
    const { app } = await makeApp();
    let last;
    for (const id of ['personal', 'education', 'experience', 'skills', 'languages', 'wishes']) {
      last = await app.inject({ method: 'POST', url: `/api/profile/sections/${id}/confirm`, headers: H, payload: {} });
      expect(last.statusCode).toBe(200);
    }
    expect(last!.json().readiness).toEqual({ ready: true, missing: [], warnings: ['noStories'] });
    expect(last!.json().profile.sections.wishes.aiFields).toEqual([]);
  });

  it('saves the wizard step and completion', async () => {
    const { app } = await makeApp();
    await app.inject({ method: 'PUT', url: '/api/profile/wizard', headers: H, payload: { step: 3 } });
    const res = await app.inject({ method: 'PUT', url: '/api/profile/wizard', headers: H, payload: { step: 4, completed: true } });
    expect(res.json().profile.wizard.step).toBe(4);
    expect(res.json().profile.wizard.completedAt).toMatch(/^\d{4}-/);
    const bad = await app.inject({ method: 'PUT', url: '/api/profile/wizard', headers: H, payload: { step: 5 } });
    expect(bad.statusCode).toBe(400);
  });

  it('adds, changes and deletes stories', async () => {
    const { app } = await makeApp();
    const added = await app.inject({
      method: 'POST', url: '/api/profile/stories', headers: H,
      payload: { title: ' Bakery website ', text: 'I built a website for a bakery.', kind: 'client', disclosure: 'ok' },
    });
    const story = added.json().profile.stories[0];
    expect(story).toMatchObject({ title: 'Bakery website', confirmed: true });
    expect(added.json().readiness.warnings).toEqual([]);
    const changed = await app.inject({
      method: 'PUT', url: `/api/profile/stories/${story.id}`, headers: H,
      payload: { title: 'Bakery', text: story.text, kind: 'client', disclosure: 'never', confirmed: true },
    });
    expect(changed.json().profile.stories[0]).toMatchObject({ title: 'Bakery', disclosure: 'never' });
    const gone = await app.inject({ method: 'DELETE', url: `/api/profile/stories/${story.id}`, headers: H });
    expect(gone.json().profile.stories).toEqual([]);
    const missing = await app.inject({ method: 'DELETE', url: `/api/profile/stories/${story.id}`, headers: H });
    expect(missing.statusCode).toBe(404);
  });

  it('stores the never-mention list trimmed and without duplicates', async () => {
    const { app } = await makeApp();
    const res = await app.inject({ method: 'PUT', url: '/api/profile/never-mention', headers: H, payload: [' Kunde X ', '', 'Kunde X', 'Projekt Y'] });
    expect(res.json().profile.neverMention).toEqual(['Kunde X', 'Projekt Y']);
  });
});
