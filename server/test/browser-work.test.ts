import { describe, it, expect } from 'vitest';
import { browserWork } from '../src/app.js';
import { Activity } from '../src/runtime/activity.js';
import { FakePageReader } from './helpers/vacancies.js';

describe('browserWork', () => {
  it('a page-reader session counts as browser work from its start until close (once)', async () => {
    const activity = new Activity();
    const reader = browserWork(activity, new FakePageReader(() => 'Seite'));
    const s = await reader.session(new AbortController().signal, Date.now() + 1000);
    expect(activity.active()).toEqual(['browser']);
    expect((await s.open('https://www.firma.de/')).text).toBe('Seite');
    await s.close();
    await s.close();
    expect(activity.active()).toEqual([]);
  });

  it('a session that cannot start leaves no browser work behind', async () => {
    const activity = new Activity();
    const reader = browserWork(activity, new FakePageReader());
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(reader.session(ctrl.signal, Date.now() + 1000)).rejects.toMatchObject({ code: 'LLM_CANCELLED' });
    expect(activity.active()).toEqual([]);
  });

  it('no session during an update', async () => {
    const activity = new Activity();
    const end = activity.begin('update');
    const reader = browserWork(activity, new FakePageReader());
    await expect(reader.session(new AbortController().signal, Date.now() + 1000)).rejects.toMatchObject({ reason: 'updateRunning' });
    end();
  });
});
