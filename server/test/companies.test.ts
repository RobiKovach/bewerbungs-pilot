import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../src/errors.js';
import { nullLogger } from '../src/log.js';
import { Companies, FEED_EVERY_MS, fitsWishes, MAX_COMPANIES } from '../src/vacancies/companies.js';
import { boardUrl, feedUrl, parseCompanyLink, parseFeed, readFeed, type CompanyBoard } from '../src/vacancies/sources/company-feeds.js';
import type { SourceDetails } from '../src/vacancies/sources/types.js';
import { H, makeApp } from './helpers/app.js';
import { fakeSource, hit, scoringClaude, vacancy } from './helpers/vacancies.js';

const board = (link: string) => parseCompanyLink(link) as CompanyBoard;
const GH = board('https://job-boards.greenhouse.io/acme');
const LEVER = board('https://jobs.eu.lever.co/acme');
const ASHBY = board('https://jobs.ashbyhq.com/Acme%20Labs');
const PERSONIO = board('acme.jobs.personio.de/job/1');

describe('links to company boards', () => {
  it('recognises the four boards, also a link to one offer, and builds only fixed feed addresses', () => {
    expect([GH, LEVER, ASHBY, PERSONIO].map(feedUrl)).toEqual([
      'https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true', 'https://api.eu.lever.co/v0/postings/acme?mode=json',
      'https://api.ashbyhq.com/posting-api/job-board/Acme%20Labs', 'https://acme.jobs.personio.de/xml']);
    expect(feedUrl(board('https://jobs.lever.co/acme/1-2-3/apply'))).toBe('https://api.lever.co/v0/postings/acme?mode=json');
    expect(board('https://boards.greenhouse.io/embed/job_board?for=acme').account).toBe('acme');
    for (const b of [GH, LEVER, ASHBY, PERSONIO]) expect(parseCompanyLink(boardUrl(b))).toEqual(b);
  });
  it.each(['', 'acme', 'http://jobs.lever.co/acme', 'https://jobs.lever.co/', 'https://jobs.lever.co:8443/acme', 'https://u:p@jobs.lever.co/acme', 'https://jobs.lever.co.evil.example/acme',
    'https://evil.example/jobs.lever.co/acme', 'https://jobs.lever.co/..%2f..%2fx', 'https://jobs.lever.co/%E0%A4%A', 'https://a.b.jobs.personio.de', 'https://jobs.personio.de', 'https://www.acme.example/karriere',
    'https://127.0.0.1/acme', 'file:///c:/x', 'javascript:alert(1)'])('refuses %s', (link) => {
    expect(parseCompanyLink(link)).toBeNull();
  });
  it('a service taken out of the list is off', () => {
    expect(parseCompanyLink('https://jobs.lever.co/acme', ['personio'])).toBeNull();
  });
});

describe('feeds', () => {
  it('Greenhouse: HTML escaped twice, places, date, link', () => {
    const body = JSON.stringify({ jobs: [
      { id: 7, title: 'Web Developer', location: { name: 'Dresden; Berlin' }, first_published: '2026-11-01T10:00:00-05:00', absolute_url: 'https://acme.example/jobs/7', content: '&lt;p&gt;React &amp;amp; CSS&lt;/p&gt;&lt;script&gt;x()&lt;/script&gt;' },
      { id: 8, title: 'B', absolute_url: 'javascript:alert(1)' }, { id: 'a/../b', title: 'C' }, { id: 9 }, null] });
    expect(parseFeed(GH, 'Acme GmbH', body)).toEqual([
      { sourceId: 'greenhouse:acme:7', title: 'Web Developer', company: 'Acme GmbH', locations: ['Dresden', 'Berlin'], remote: 'unknown', employment: [], salaryText: '', publishedAt: '2026-11-01', url: 'https://acme.example/jobs/7', partnerUrl: '', text: 'React & CSS' },
      expect.objectContaining({ sourceId: 'greenhouse:acme:8', url: 'https://job-boards.greenhouse.io/acme/jobs/8', locations: [] })]);
  });
  it('Lever: text with its lists, remote, salary', () => {
    const body = JSON.stringify([{ id: 'ab-1', text: 'Entwickler', categories: { commitment: 'Full-time', location: 'Dresden' }, createdAt: Date.UTC(2026, 10, 2), hostedUrl: 'https://jobs.eu.lever.co/acme/ab-1', workplaceType: 'hybrid', descriptionPlain: 'Hallo', lists: [{ text: 'Aufgaben', content: '<li>Bauen</li>' }], additionalPlain: 'Ende', salaryRange: { min: 1, max: 2, currency: 'EUR' } }]);
    expect(parseFeed(LEVER, 'A', body)).toEqual([expect.objectContaining({ sourceId: 'lever:acme:ab-1', remote: 'partial', employment: ['fulltime'], publishedAt: '2026-11-02', salaryText: '1–2 EUR', text: 'Hallo\n\nAufgaben\n- Bauen\n\nEnde' })]);
  });
  it('Ashby: unlisted offers stay out', () => {
    const body = JSON.stringify({ jobs: [{ id: 'x1', title: 'Dev', isListed: true, location: 'Remote', isRemote: true, employmentType: 'PartTime', secondaryLocations: [{ location: 'Berlin' }], jobUrl: 'https://jobs.ashbyhq.com/a/x1', descriptionHtml: '<p>T</p>' }, { id: 'x2', title: 'Hidden', isListed: false }] });
    expect(parseFeed(ASHBY, 'A', body)).toEqual([expect.objectContaining({ sourceId: 'ashby:acme labs:x1', remote: 'yes', employment: ['parttime'], locations: ['Remote', 'Berlin'], text: 'T' })]);
  });
  it('Personio: CDATA, several offices, entities; a DTD or an unclosed tag gives nothing', () => {
    const xml = `<?xml version="1.0"?><workzag-jobs><position><id>5</id><office>Dresden</office><additionalOffices><office>Leipzig</office></additionalOffices><name>Entwickler &amp; mehr</name>
      <jobDescriptions><jobDescription><name>Aufgaben</name><value><![CDATA[<p>Bauen</p>]]></value></jobDescription></jobDescriptions>
      <employmentType>permanent</employmentType><schedule>full-or-part-time</schedule><createdAt>2026-11-03T08:00:00+00:00</createdAt></position><position><id>6</id></position></workzag-jobs>`;
    expect(parseFeed(PERSONIO, 'A', xml)).toEqual([expect.objectContaining({ sourceId: 'personio:acme:5', title: 'Entwickler & mehr', locations: ['Dresden', 'Leipzig'], employment: ['fulltime', 'parttime'], publishedAt: '2026-11-03', url: 'https://acme.jobs.personio.de/job/5', text: 'Aufgaben\nBauen' })]);
    expect(parseFeed(PERSONIO, 'A', `<!DOCTYPE a [<!ENTITY x "y">]>${xml}`)).toBeNull();
    const t = Date.now();
    expect(parseFeed(PERSONIO, 'A', `<workzag-jobs>${'<position><id>1'.repeat(300_000)}`)).toEqual([]);
    expect(Date.now() - t).toBeLessThan(2000);
  });
  it('an answer of another form is an error, not an empty list', () => {
    for (const b of [GH, LEVER, ASHBY, PERSONIO]) for (const body of ['<html></html>', '{"ok":false}', '', 'null']) expect(parseFeed(b, 'A', body)).toBeNull();
  });
});

describe('readFeed over the network', () => {
  async function serve(handler: http.RequestListener) {
    const s = http.createServer(handler);
    await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
    return { base: `http://127.0.0.1:${(s.address() as AddressInfo).port}`, close: () => { s.closeAllConnections(); s.close(); } };
  }
  const local = { check: async () => ({ ok: true as const }), isPublic: () => true };
  const never = new AbortController().signal;

  it('reads; a redirect to another host, a too big body and a 404 are refused', async () => {
    const s = await serve((req, res) => {
      if (req.url === '/feeds/lever/acme') res.end('[]');
      else if (req.url === '/feeds/greenhouse/acme') { res.writeHead(302, { location: `http://localhost:1/x` }); res.end(); }
      else if (req.url === '/feeds/personio/acme') { const big = Buffer.alloc(1024 * 1024); let n = 0; const more = () => { while (n++ < 40) if (!res.write(big)) { res.once('drain', more); return; } res.end(); }; more(); }
      else { res.writeHead(404); res.end(); }
    });
    try {
      expect(await readFeed(LEVER, 'A', never, { ...local, testBase: s.base })).toEqual([]);
      for (const [b, why] of [[GH, 'blocked'], [PERSONIO, 'tooBig'], [ASHBY, 'status']] as const) {
        await expect(readFeed(b, 'A', never, { ...local, testBase: s.base })).rejects.toMatchObject({ code: 'SOURCE_UNAVAILABLE', reason: 'companyRead', detailsForLog: `${b.service}: ${why}` });
      }
      // The usual rules refuse this PC.
      await expect(readFeed(LEVER, 'A', never, { testBase: s.base })).rejects.toMatchObject({ detailsForLog: 'lever: blocked' });
    } finally { s.close(); }
  });
});

const offer = (id: string, over: Partial<SourceDetails> = {}): SourceDetails => ({ ...hit({ sourceId: id, company: 'Acme GmbH', title: `Webentwickler ${id}` }), text: 'Volltext', partnerUrl: '', ...over });
const LINK = 'https://jobs.lever.co/acme';

async function setup(read: () => SourceDetails[] | Promise<SourceDetails[]>, opts: { aa?: () => ReturnType<typeof hit>[] } = {}) {
  const readFeedFake = vi.fn(async () => read());
  const source = fakeSource({ search: opts.aa ?? (() => []) });
  const ctx = await makeApp({ provider: scoringClaude(), source, readFeed: readFeedFake });
  ctx.profileStore.update((p) => { p.sections.wishes.data = { ...p.sections.wishes.data, jobTitles: ['Webentwickler'], locations: ['Dresden'] }; });
  const add = (url = LINK, name = 'Acme GmbH') => ctx.app.inject({ method: 'POST', url: '/api/companies', headers: H, payload: { url, name } });
  const search = async () => { ctx.searchJob.start(); await ctx.searchJob.whenIdle(); return ctx.searchJob.state(); };
  return { ctx, source, add, search, readFeedFake };
}

describe('followed companies', () => {
  it('add, list, refuse twice / a foreign link / an unreadable board, remove; survives a restart', async () => {
    let down = false;
    const { ctx, add } = await setup(() => { if (down) throw new AppError('SOURCE_UNAVAILABLE', 'lever: status', 'companyRead'); return [offer('lever:acme:1')]; });
    expect((await add()).json().companies).toEqual([expect.objectContaining({ name: 'Acme GmbH', service: 'lever', account: 'acme', url: LINK, offers: 1, lastReadFailed: false })]);
    expect((await add('https://jobs.lever.co/ACME')).json().error).toMatchObject({ code: 'CONFLICT', reason: 'companyExists' });
    expect((await add('https://acme.example')).json().error).toMatchObject({ code: 'BAD_REQUEST', reason: 'companyLink' });
    expect((await add('https://jobs.lever.co/b', ' ')).statusCode).toBe(400);
    down = true;
    expect((await add('https://jobs.lever.co/b')).json().error).toMatchObject({ code: 'SOURCE_UNAVAILABLE', reason: 'companyRead' });
    ctx.companies.load();
    const [c] = ctx.companies.list();
    expect(c).toMatchObject({ account: 'acme', offers: null });
    expect((await ctx.app.inject({ method: 'DELETE', url: `/api/companies/${c.id}`, headers: H })).json().companies).toEqual([]);
    expect((await ctx.app.inject({ method: 'DELETE', url: `/api/companies/${c.id}`, headers: H })).statusCode).toBe(404);
  });

  it('at most 20; a broken file is set aside, a tampered entry is dropped', async () => {
    const { ctx } = await setup(() => []);
    for (let i = 0; i < MAX_COMPANIES; i++) await ctx.companies.add(`https://jobs.lever.co/c${i}`, 'C', new AbortController().signal);
    await expect(ctx.companies.add('https://jobs.lever.co/more', 'C', new AbortController().signal)).rejects.toMatchObject({ reason: 'companyLimit' });
    const file = path.join(ctx.dir, 'vacancies', 'companies.json');
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    doc.companies[0].host = 'evil.example';
    doc.companies[1].service = 'evil';
    fs.writeFileSync(file, JSON.stringify(doc));
    ctx.companies.load();
    expect(ctx.companies.list()).toHaveLength(MAX_COMPANIES - 2);
    fs.writeFileSync(file, '{ broken');
    ctx.companies.load();
    expect(ctx.companies.list()).toEqual([]);
    expect(fs.readdirSync(path.dirname(file)).some((f) => /^companies\.corrupt-\d+\.json$/.test(f))).toBe(true);
  });

  it('one company is asked at most once in six hours', async () => {
    let now = new Date('2026-11-24T08:00:00Z');
    const read = vi.fn(async () => [offer('lever:acme:1')]);
    const { ctx } = await setup(() => []);
    const c = new Companies({ file: path.join(ctx.dir, 'c.json'), logger: nullLogger, read, now: () => now });
    const s = new AbortController().signal;
    await c.add(LINK, 'Acme', s);
    await c.readAll(s);
    expect((await c.readAll(s)).offers).toHaveLength(1);
    expect(read).toHaveBeenCalledTimes(1);
    now = new Date(now.getTime() + FEED_EVERY_MS);
    await c.readAll(s);
    expect(read).toHaveBeenCalledTimes(2);
  });
});

describe('search with companies', () => {
  it('takes fitting offers as company cards without asking Arbeitsagentur for them; scores them; a second search finds nothing new', async () => {
    const { ctx, source, add, search } = await setup(() => [offer('lever:acme:1'), offer('lever:acme:2', { title: 'Koch' }), offer('lever:acme:3', { locations: ['Paris'] })]);
    await add();
    expect(await search()).toMatchObject({ state: 'done', found: 1, toScore: 1, warnings: [] });
    const [v] = ctx.vacancyStore.list();
    expect(v).toMatchObject({ source: 'company', sourceId: 'lever:acme:1', company: 'Acme GmbH', addedManually: false, hasText: true, scoreState: 'scored' });
    expect(source.detailCalls).toEqual([]);
    expect(await search()).toMatchObject({ toScore: 0, filteredOut: { seen: 1 } });
    expect(source.onlineCalls).toEqual([]);
    // Hidden and back: the text is kept, no source is asked.
    for (const status of ['hidden', 'new']) expect((await ctx.app.inject({ method: 'POST', url: `/api/vacancies/${v.id}/status`, headers: H, payload: { status } })).statusCode).toBe(200);
    expect((await ctx.app.inject({ method: 'POST', url: `/api/vacancies/${v.id}/text/refresh`, headers: H })).statusCode).toBe(409);
    expect((await ctx.app.inject({ method: 'GET', url: `/api/vacancies/${v.id}/text` })).json().text).toBe('Volltext');
  });

  it('the same offer on both boards is taken once', async () => {
    const { ctx, add, search } = await setup(() => [offer('lever:acme:1', { title: 'Webentwickler (m/w/d)' })], { aa: () => [hit({ company: 'Acme GmbH', title: 'Webentwickler' })] });
    await add();
    expect(await search()).toMatchObject({ toScore: 1, filteredOut: { seen: 1 } });
    expect(ctx.vacancyStore.list().map((v) => v.source)).toEqual(['arbeitsagentur']);
  });

  it('a failing company is a warning; a failing Arbeitsagentur does not stop the companies; both failing is an error', async () => {
    let companyDown = true;
    let aaDown = false;
    const down = () => { throw new AppError('SOURCE_UNAVAILABLE', 'x'); };
    const { ctx, search } = await setup(() => (companyDown ? down() : [offer('lever:acme:1')]), { aa: () => (aaDown ? down() : []) });
    companyDown = false;
    await ctx.companies.add(LINK, 'Acme', new AbortController().signal);
    ctx.companies.load();
    companyDown = true;
    expect(await search()).toMatchObject({ state: 'done', warnings: ['someCompaniesFailed'] });
    expect(ctx.companies.list()[0].lastReadFailed).toBe(true);
    aaDown = true;
    expect(await search()).toMatchObject({ state: 'failed', error: { code: 'SOURCE_UNAVAILABLE' } });
    companyDown = false;
    expect(await search()).toMatchObject({ state: 'done', toScore: 1, warnings: ['someQueriesFailed'] });
    expect(ctx.companies.list()[0].lastReadFailed).toBe(false);
  });

  it('a removed offer is noticed only when its own board was read', async () => {
    let offers = [offer('lever:acme:1')];
    const { ctx, search } = await setup(() => offers);
    ctx.vacancyStore.add(vacancy({ id: 'new', source: 'company', sourceId: 'lever:acme:8' }), 'x');
    ctx.vacancyStore.add(vacancy({ id: 'fav', source: 'company', sourceId: 'lever:acme:9', status: 'favorite' }), 'x');
    ctx.vacancyStore.add(vacancy({ id: 'other', source: 'company', sourceId: 'lever:acme2:1' }), 'x');
    await search();
    expect(ctx.vacancyStore.get('new')?.status).toBe('new');
    await ctx.companies.add(LINK, 'Acme', new AbortController().signal);
    await search();
    expect(ctx.vacancyStore.get('new')?.status).toBe('stale');
    expect(ctx.vacancyStore.get('fav')).toMatchObject({ status: 'favorite', offline: true });
    expect(ctx.vacancyStore.get('other')?.status).toBe('new');
    // Back on the board, even when its title is no longer wished.
    offers = [offer('lever:acme:9', { title: 'Koch' })];
    ctx.companies.load();
    await search();
    expect(ctx.vacancyStore.get('fav')?.offline).toBeUndefined();
  });
});

describe('fitsWishes', () => {
  const w = (over: object = {}) => ({ jobTitles: ['Webentwickler', 'Projektmanager'], locations: ['München'], remote: 'any' as never, ...over });
  const fits = (title: string, locations: string[] = ['München'], over: object = {}, remote: 'yes' | 'unknown' = 'unknown') => fitsWishes({ title, locations, remote }, w(over));
  it('title: a telling shared word, not only "Senior" or "Manager"', () => {
    expect(fits('Frontend-Entwickler (m/w/d)')).toBe(true);
    expect(fits('Senior Webentwickler*in')).toBe(true);
    expect(fits('Koch')).toBe(false);
    expect(fits('Web Developer', ['München'], { jobTitles: ['Senior Frontend Engineer'] })).toBe(false);
    expect(fits('Senior Accountant', ['München'], { jobTitles: ['Senior Developer'] })).toBe(false);
  });
  it('place: a wished city (also in English), remote, or unknown', () => {
    expect(fits('Webentwickler', ['Munich, Germany'])).toBe(true);
    expect(fits('Webentwickler', ['Berlin'])).toBe(false);
    expect(fits('Webentwickler', ['Berlin'], {}, 'yes')).toBe(true);
    expect(fits('Webentwickler', [])).toBe(true);
    expect(fits('Webentwickler', ['Germany'])).toBe(true);
    expect(fits('Webentwickler', ['Berlin'], { locations: [] })).toBe(true);
  });
});
