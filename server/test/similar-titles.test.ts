import { describe, expect, it } from 'vitest';
import { AppError } from '../src/errors.js';
import { FakeProvider } from '../src/llm/fake.js';
import { emptyProfile } from '../src/profile/schema.js';
import { similarTitlesTask, toSimilarTitles } from '../src/vacancies/tasks/similar-titles.js';
import { H, makeApp } from './helpers/app.js';
import { readyPackageProfile } from './helpers/applications.js';
import { SAMPLE_CV } from './helpers/profile.js';

const URL = '/api/vacancies/similar-titles';

describe('similar titles task', () => {
  it('sends titles, degrees and skills only', () => {
    const p = emptyProfile();
    p.sections.personal.data = { ...SAMPLE_CV.personal, birthDate: '1990-03-15', nationality: 'deutsch' };
    p.sections.experience.data.items = [{ id: 'e', jobTitle: 'Webentwickler', employer: 'Geheim AG', city: 'Hamburg', country: 'DE', from: '2018-01', to: '', description: 'Kunde Privat' }];
    p.sections.skills.data.items = [{ id: 's', name: 'TYPO3', level: 'expert' }];
    p.sections.wishes.data = { ...p.sections.wishes.data, jobTitles: ['Frontend-Entwickler'], locations: ['Dresden'], salaryMinEur: 45123, notes: 'Notiz privat' };
    const task = similarTitlesTask(p, 'uk');
    expect(task.prompt).toMatch(/<<<UNTRUSTED_PROFILE_[0-9a-f]{16}>>>/);
    expect(task.allowWebSearch).toBeFalsy();
    for (const kept of ['Webentwickler', 'TYPO3 (expert)', 'Frontend-Entwickler']) expect(task.prompt).toContain(kept);
    for (const gone of ['Max Mustermann', 'max@example.com', 'Geheim AG', 'Hamburg', 'Kunde Privat', 'Dresden', '45123', 'Notiz privat', '1990', '2018', 'deutsch"', 'Musterstraße']) {
      expect(task.prompt).not.toContain(gone);
    }
  });

  it('drops wished titles, repeats, empty and too long ones; cuts the reason and the number', () => {
    const t = (title: string, why = 'w') => ({ title, why });
    expect(toSimilarTitles({ titles: [
      t('webentwickler (m/w/d)'), t('Front-End Entwickler'), t(' TYPO3  Entwickler (w/m/d) ', ` a\n${'x'.repeat(300)}`), t('Typo3-Entwickler'),
      t(' '), t('12'), t('L'.repeat(101)),
    ] }, ['Webentwickler', 'Frontend Entwickler'])).toEqual([{ title: 'TYPO3 Entwickler', why: `a ${'x'.repeat(148)}` }]);
    expect(toSimilarTitles({ titles: 'abcdefghij'.split('').map((c) => t(`Beruf ${c}`)) }, [])).toHaveLength(8);
  });
});

describe('POST /api/vacancies/similar-titles', () => {
  const post = (app: Awaited<ReturnType<typeof makeApp>>['app']) => app.inject({ method: 'POST', url: URL, headers: H, payload: {} });

  it('answers the checked list and saves nothing', async () => {
    const provider = new FakeProvider({ ok: true }, () => ({ titles: [{ title: 'TYPO3-Entwickler', why: 'TYPO3' }, { title: 'Webentwickler', why: 'x' }] }));
    const ctx = await makeApp({ provider });
    ctx.profileStore.update((p) => { p.sections = readyPackageProfile().sections; p.sections.wishes.data.jobTitles = ['Webentwickler']; });
    const before = JSON.stringify(ctx.profileStore.get());
    const r = await post(ctx.app);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ titles: [{ title: 'TYPO3-Entwickler', why: 'TYPO3' }] });
    expect(JSON.stringify(ctx.profileStore.get())).toBe(before);
    expect(provider.calls.map((c) => c.id)).toEqual(['similar-titles']);
  });

  it('an empty profile does not cost an AI call; AI errors come through', async () => {
    const provider = new FakeProvider({ ok: true }, () => { throw new AppError('LLM_LIMIT', 'limit'); });
    const ctx = await makeApp({ provider });
    const empty = await post(ctx.app);
    expect([empty.statusCode, empty.json().error.code]).toEqual([409, 'WISHES_INCOMPLETE']);
    expect(provider.calls).toEqual([]);
    ctx.profileStore.update((p) => { p.sections.wishes.data.jobTitles = ['Webentwickler']; });
    expect((await post(ctx.app)).json().error.code).toBe('LLM_LIMIT');
  });
});
