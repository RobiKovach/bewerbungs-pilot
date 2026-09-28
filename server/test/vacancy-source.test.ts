import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { AppError } from '../src/errors.js';
import { ArbeitsagenturSource, htmlToText, jobdetailRefnr, jobdetailUrl } from '../src/vacancies/sources/arbeitsagentur.js';
import type { SearchQuery } from '../src/vacancies/sources/types.js';

const fixture = (name: string) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')) as unknown;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const QUERY: SearchQuery = {
  jobTitle: 'Frontend Developer', location: 'Dresden', radiusKm: 30, kind: 'work', workTimes: ['fulltime', 'parttime'],
  publishedWithinDays: 14, includeTemporaryAgencies: false,
};
const signal = () => new AbortController().signal;

/** A fetch that answers from a list and records every call. */
function fakeFetch(answers: (Response | Error | ((url: string) => Response))[]) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fn = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string> });
    const next = answers.shift();
    if (!next) throw new Error('no more answers');
    if (next instanceof Error) throw next;
    return typeof next === 'function' ? next(String(url)) : next;
  }) as typeof fetch;
  return { fn, calls };
}
const noSleep = async () => {};

describe('ArbeitsagenturSource.search', () => {
  it('builds the query and turns the answer into hits', async () => {
    const f = fakeFetch([json(fixture('aa-search.json'))]);
    const hits = await new ArbeitsagenturSource({ fetch: f.fn, sleep: noSleep }).search(QUERY, signal());
    const url = new URL(f.calls[0].url);
    expect(url.origin + url.pathname).toBe('https://rest.arbeitsagentur.de/jobboerse/jobsuche-service/pc/v6/jobs');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      was: 'Frontend Developer', wo: 'Dresden', umkreis: '30', veroeffentlichtseit: '14', angebotsart: '1',
      arbeitszeit: 'vz;tz', zeitarbeit: 'false', size: '50', page: '1',
    });
    expect(f.calls[0].headers['X-API-Key']).toBe('jobboerse-jobsuche');
    expect(hits).toHaveLength(2); // the entry without referenznummer is skipped
    expect(hits[0]).toEqual({
      sourceId: '10000-1111111111-S', title: 'Frontend Developer (m/w/d)', company: 'Muster GmbH',
      locations: ['Dresden', 'Leipzig'], remote: 'partial', employment: ['fulltime', 'parttime'],
      salaryText: '45000–55000 €', publishedAt: '2026-09-22',
      url: 'https://www.arbeitsagentur.de/jobsuche/jobdetail/10000-1111111111-S',
    });
    expect(hits[1]).toMatchObject({ title: 'WordPress Entwickler*in', company: 'Beispiel AG', locations: [], remote: 'unknown', employment: [], salaryText: '', publishedAt: '' });
  });

  it('leaves out wo/umkreis without a location, arbeitszeit for apprenticeships, zeitarbeit when allowed', async () => {
    const f = fakeFetch([json({ maxErgebnisse: 0 })]);
    await new ArbeitsagenturSource({ fetch: f.fn, sleep: noSleep })
      .search({ ...QUERY, location: null, kind: 'apprenticeship', includeTemporaryAgencies: true }, signal());
    const p = Object.fromEntries(new URL(f.calls[0].url).searchParams);
    expect(p).toEqual({ was: 'Frontend Developer', veroeffentlichtseit: '14', angebotsart: '4', size: '50', page: '1' });
  });

  it('reads a second page only when the first one was full', async () => {
    const page = (n: number, from: number) => ({ maxErgebnisse: 70, ergebnisliste: Array.from({ length: n }, (_, i) => ({ referenznummer: `R-${from + i}`, stellenangebotsTitel: 'T', firma: 'F' })) });
    const f = fakeFetch([json(page(50, 0)), json(page(20, 50))]);
    const hits = await new ArbeitsagenturSource({ fetch: f.fn, sleep: noSleep }).search(QUERY, signal());
    expect(hits).toHaveLength(70);
    expect(new URL(f.calls[1].url).searchParams.get('page')).toBe('2');
  });

  it('retries once on 5xx / network error, then gives SOURCE_UNAVAILABLE', async () => {
    const ok = fakeFetch([json({}, 503), json(fixture('aa-search.json'))]);
    expect(await new ArbeitsagenturSource({ fetch: ok.fn, sleep: noSleep }).search(QUERY, signal())).toHaveLength(2);
    const bad = fakeFetch([new TypeError('fetch failed'), json({}, 502)]);
    await expect(new ArbeitsagenturSource({ fetch: bad.fn, sleep: noSleep }).search(QUERY, signal()))
      .rejects.toMatchObject({ code: 'SOURCE_UNAVAILABLE' });
  });

  it('429 twice → SOURCE_RATE_LIMITED; 403 → SOURCE_CHANGED without retry', async () => {
    const limited = fakeFetch([json({}, 429), json({}, 429)]);
    await expect(new ArbeitsagenturSource({ fetch: limited.fn, sleep: noSleep }).search(QUERY, signal()))
      .rejects.toMatchObject({ code: 'SOURCE_RATE_LIMITED' });
    const changed = fakeFetch([json({}, 403)]);
    await expect(new ArbeitsagenturSource({ fetch: changed.fn, sleep: noSleep }).search(QUERY, signal()))
      .rejects.toMatchObject({ code: 'SOURCE_CHANGED' });
    expect(changed.calls).toHaveLength(1);
  });

  it('an answer of the wrong shape is SOURCE_CHANGED, not a crash', async () => {
    for (const body of [[], 'text', { ergebnisliste: 'x' }]) {
      const f = fakeFetch([json(body)]);
      await expect(new ArbeitsagenturSource({ fetch: f.fn, sleep: noSleep }).search(QUERY, signal()))
        .rejects.toMatchObject({ code: 'SOURCE_CHANGED' });
    }
    const notJson = fakeFetch([new Response('<html>', { status: 200 })]);
    await expect(new ArbeitsagenturSource({ fetch: notJson.fn, sleep: noSleep }).search(QUERY, signal()))
      .rejects.toMatchObject({ code: 'SOURCE_CHANGED' });
  });

  it('a hanging request times out as SOURCE_UNAVAILABLE', async () => {
    const hang = (async (_url: string | URL, init?: RequestInit) => new Promise<Response>((_r, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })) as typeof fetch;
    await expect(new ArbeitsagenturSource({ fetch: hang, sleep: noSleep, timeoutMs: 20 }).search(QUERY, signal()))
      .rejects.toMatchObject({ code: 'SOURCE_UNAVAILABLE' });
  });

  it('a stopped search is LLM_CANCELLED, not a source error', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const f = fakeFetch([json(fixture('aa-search.json'))]);
    const err = await new ArbeitsagenturSource({ fetch: f.fn, sleep: noSleep }).search(QUERY, ctrl.signal).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('LLM_CANCELLED');
  });
});

describe('ArbeitsagenturSource.details / isOnline', () => {
  it('asks by base64 number, returns plain text and the partner link', async () => {
    const f = fakeFetch([json(fixture('aa-details.json'))]);
    const d = await new ArbeitsagenturSource({ fetch: f.fn, sleep: noSleep }).details('10000-1111111111-S', signal());
    expect(f.calls[0].url).toBe(`https://rest.arbeitsagentur.de/jobboerse/jobsuche-service/pc/v4/jobdetails/${Buffer.from('10000-1111111111-S').toString('base64')}`);
    expect(d).toMatchObject({ sourceId: '10000-1111111111-S', title: 'Frontend Developer (m/w/d)', remote: 'no', url: 'https://karriere.muster.example/job/1' });
    expect(d?.text).toBe('Wir suchen Sie & Ihr Team!\n\n- React\n- TypeScript\n\nKontakt: jobs@muster.example\nTel. 0351 000');
  });
  it('404 = gone', async () => {
    const f = fakeFetch([json({}, 404), json({}, 404)]);
    const s = new ArbeitsagenturSource({ fetch: f.fn, sleep: noSleep });
    expect(await s.details('X-1', signal())).toBeNull();
    expect(await s.isOnline('X-1', signal())).toBe(false);
  });
  it('a partner link that is not http(s) falls back to the Arbeitsagentur page', async () => {
    const f = fakeFetch([json({ ...(fixture('aa-details.json') as object), allianzpartnerUrl: 'javascript:alert(1)' })]);
    const d = await new ArbeitsagenturSource({ fetch: f.fn, sleep: noSleep }).details('10000-1111111111-S', signal());
    expect(d?.url).toBe(jobdetailUrl('10000-1111111111-S'));
  });
});

describe('jobdetailRefnr', () => {
  it.each([
    ['https://www.arbeitsagentur.de/jobsuche/jobdetail/10000-1111111111-S', '10000-1111111111-S'],
    ['https://www.arbeitsagentur.de/jobsuche/jobdetail/10000-1111111111-S/', '10000-1111111111-S'],
    ['https://www.arbeitsagentur.de/jobsuche/jobdetail/10000-1111111111-S?pos=3#top', '10000-1111111111-S'],
  ])('accepts %s', (url, refnr) => { expect(jobdetailRefnr(url)).toBe(refnr); });
  it.each([
    'http://www.arbeitsagentur.de/jobsuche/jobdetail/10000-1111111111-S',
    'https://arbeitsagentur.de.evil.example/jobsuche/jobdetail/10000-1111111111-S',
    'https://evil.example/https://www.arbeitsagentur.de/jobsuche/jobdetail/10000-1111111111-S',
    'https://user@www.arbeitsagentur.de/jobsuche/jobdetail/10000-1111111111-S',
    'https://www.arbeitsagentur.de:8443/jobsuche/jobdetail/10000-1111111111-S',
    'https://www.arbeitsagentur.de/jobsuche/suche?was=x',
    'https://www.arbeitsagentur.de/jobsuche/jobdetail/../../etc',
    'not a url',
  ])('refuses %s', (url) => { expect(jobdetailRefnr(url)).toBeNull(); });
});

describe('htmlToText', () => {
  it('keeps structure, drops tags and scripts, decodes entities', () => {
    expect(htmlToText('<h2>Aufgaben</h2><p>A&nbsp;&lt;B&gt;</p><script>x()</script><style>p{}</style>Ende'))
      .toBe('Aufgaben\n\nA <B>\n\nEnde');
  });

  it('keeps Markdown autolinks, angle-bracket addresses and </>/ comparisons readable', () => {
    expect(htmlToText('Kontakt: <jobs@muster.example> oder <https://muster.example/karriere>\nGehalt < 50.000 EUR, Team > 5 Personen'))
      .toBe('Kontakt: <jobs@muster.example> oder <https://muster.example/karriere>\nGehalt < 50.000 EUR, Team > 5 Personen');
  });
});
