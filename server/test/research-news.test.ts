import { describe, expect, it, vi } from 'vitest';
import { NEWS_ENABLED, fetchNews, newsQueryUrl, newsSource, parseNewsRss } from '../src/research/news.js';
import { SafeGetError, type safeGetBytes } from '../src/vacancies/sources/safe-get.js';

const NOW = new Date('2026-11-11T10:00:00Z');

const item = (title: string, date: string, source: string, link: string) => `
  <item>
    <title>${title}</title>
    <link>${link}</link>
    <guid isPermaLink="false">x</guid>
    <pubDate>${date}</pubDate>
    <description>&lt;a href="${link}"&gt;${title}&lt;/a&gt;</description>
    <source url="https://example.org">${source}</source>
  </item>`;

const rss = (...items: string[]) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><rss version="2.0"><channel><title>"Symate" - Google News</title>${items.join('')}</channel></rss>`;

const FIXTURE = rss(
  item('Symate eröffnet neuen Standort - Sächsische.de', 'Mon, 05 Oct 2026 07:00:00 GMT', 'Sächsische.de', 'https://news.google.com/rss/articles/AAA?oc=5'),
  item('Alte Meldung über Symate - DNN', 'Tue, 01 Apr 2025 08:00:00 GMT', 'DNN', 'https://news.google.com/rss/articles/OLD?oc=5'),
  item('Symate gewinnt Preis - MDR', 'Fri, 30 Oct 2026 12:30:00 GMT', 'MDR', 'https://news.google.com/rss/articles/BBB?oc=5'),
);

const bytes = (s: string) => new TextEncoder().encode(s);

describe('research news', () => {
  it('parses a Google News RSS fixture: titles, dates, source, newest first, older than 180 days dropped', () => {
    expect(parseNewsRss(FIXTURE, NOW)).toEqual([
      { title: 'Symate gewinnt Preis - MDR', date: '2026-10-30', source: 'MDR', url: 'https://news.google.com/rss/articles/BBB?oc=5' },
      { title: 'Symate eröffnet neuen Standort - Sächsische.de', date: '2026-10-05', source: 'Sächsische.de', url: 'https://news.google.com/rss/articles/AAA?oc=5' },
    ]);
  });

  it('keeps at most 10 items and drops items without a date, a title or an http(s) link', () => {
    const many = Array.from({ length: 14 }, (_, i) =>
      item(`News ${i}`, new Date(NOW.getTime() - (i + 1) * 86_400_000).toUTCString(), 'S', `https://news.google.com/rss/articles/${i}`));
    const out = parseNewsRss(rss(
      ...many,
      item('No date', 'kein Datum', 'S', 'https://news.google.com/rss/articles/x'),
      item('', 'Mon, 09 Nov 2026 07:00:00 GMT', 'S', 'https://news.google.com/rss/articles/y'),
      item('Bad link', 'Mon, 09 Nov 2026 07:00:00 GMT', 'S', 'javascript:alert(1)'),
    ), NOW);
    expect(out).toHaveLength(10);
    expect(out[0].title).toBe('News 0');
    expect(out.map((n) => n.title)).not.toContain('No date');
    expect(out.map((n) => n.title)).not.toContain('Bad link');
  });

  it('entities and CDATA are decoded', () => {
    const xml = rss(
      item('<![CDATA[Müller & Söhne <neu> "gut"]]>', 'Mon, 09 Nov 2026 07:00:00 GMT', 'A &amp; B', 'https://news.google.com/rss/articles/C?a=1&amp;b=2'),
      item('Tom &amp; Jerry &lt;GmbH&gt; &quot;x&quot; &#39;y&#39;', 'Sun, 08 Nov 2026 07:00:00 GMT', '<![CDATA[Zeit & Co]]>', 'https://news.google.com/rss/articles/D'),
    );
    expect(parseNewsRss(xml, NOW)).toEqual([
      { title: 'Müller & Söhne <neu> "gut"', date: '2026-11-09', source: 'A & B', url: 'https://news.google.com/rss/articles/C?a=1&b=2' },
      { title: `Tom & Jerry <GmbH> "x" 'y'`, date: '2026-11-08', source: 'Zeit & Co', url: 'https://news.google.com/rss/articles/D' },
    ]);
  });

  it('builds the query from the name without its legal form', () => {
    expect(newsQueryUrl('Symate GmbH')).toBe(
      'https://news.google.com/rss/search?q=%22symate%22+when:180d&hl=de&gl=DE&ceid=DE:de');
    expect(newsQueryUrl('Helm & Walter GmbH & Co. KG')).toBe(
      'https://news.google.com/rss/search?q=%22helm%20%26%20walter%22+when:180d&hl=de&gl=DE&ceid=DE:de');
  });

  it('generic company name → no request', async () => {
    const get = vi.fn<typeof safeGetBytes>();
    for (const name of ['', 'Personalvermittlung', 'Arbeitgeber GmbH', 'AB']) {
      expect(newsQueryUrl(name)).toBeNull();
      expect(await fetchNews(name, new AbortController().signal, get)).toBeNull();
    }
    expect(get).not.toHaveBeenCalled();
  });

  it('asks only news.google.com with 1 MB and 10 s and parses the answer', async () => {
    const get = vi.fn<typeof safeGetBytes>(async () => bytes(FIXTURE));
    const signal = new AbortController().signal;
    const out = await fetchNews('Symate GmbH', signal, get);
    expect(out?.map((n) => n.source)).toEqual(['MDR', 'Sächsische.de']);
    const [url, opts] = get.mock.calls[0];
    expect(url).toBe(newsQueryUrl('Symate GmbH'));
    expect(opts).toMatchObject({ maxBytes: 1024 * 1024, timeoutMs: 10_000, signal, allowHosts: ['news.google.com'] });
  });

  it('valid RSS with no items → [] (nothing found, not a failure)', async () => {
    const empty = vi.fn<typeof safeGetBytes>(async () => bytes(rss()));
    expect(await fetchNews('Symate GmbH', new AbortController().signal, empty)).toEqual([]);
  });

  it('network error → null, cancel → LLM_CANCELLED', async () => {
    const failing = vi.fn<typeof safeGetBytes>(async () => { throw new SafeGetError('network'); });
    expect(await fetchNews('Symate GmbH', new AbortController().signal, failing)).toBeNull();
    const blocked = vi.fn<typeof safeGetBytes>(async () => { throw new SafeGetError('blocked'); });
    expect(await fetchNews('Symate GmbH', new AbortController().signal, blocked)).toBeNull();
    const garbage = vi.fn<typeof safeGetBytes>(async () => bytes('<html>nope</html>'));
    expect(await fetchNews('Symate GmbH', new AbortController().signal, garbage)).toBeNull();

    const ctl = new AbortController();
    const slow = vi.fn<typeof safeGetBytes>((_url, opts) => new Promise((_, reject) => {
      opts.signal.addEventListener('abort', () => reject(new SafeGetError('network')));
    }));
    const pending = fetchNews('Symate GmbH', ctl.signal, slow);
    ctl.abort();
    await expect(pending).rejects.toMatchObject({ code: 'LLM_CANCELLED' });

    const already = new AbortController();
    already.abort();
    await expect(fetchNews('Symate GmbH', already.signal, failing)).rejects.toMatchObject({ code: 'LLM_CANCELLED' });
  });
});

describe('newsSource (Ruling R38: Google News off until decided)', () => {
  it('while news are off nothing is asked and the answer is "could not be loaded"', async () => {
    expect(NEWS_ENABLED).toBe(false);
    expect(await newsSource()('Symate GmbH', new AbortController().signal)).toBeNull();
    const stopped = new AbortController();
    stopped.abort();
    await expect(newsSource()('Symate GmbH', stopped.signal)).rejects.toMatchObject({ code: 'LLM_CANCELLED' });
  });
});
