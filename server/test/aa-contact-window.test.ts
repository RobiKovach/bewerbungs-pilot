import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Browser } from 'puppeteer-core';
import {
  AaContactWindow, applicationBlock, COOKIE_SCRIPT, contactLaunchOptions, READ_FRAME_SCRIPT, SCROLL_SCRIPT, withoutAaService,
} from '../src/vacancies/sources/aa-contact-window.js';
import type { checkPublicUrl } from '../src/vacancies/sources/safe-address.js';

type Check = typeof checkPublicUrl;
const publicCheck: Check = async () => ({ ok: true });
const REFNR = '12345-ABCDEF-S';

/** What one frame shows on one poll (all values invented — no real contact data). */
interface FrameData { url?: string; text: string; hrefs?: string[]; links?: Array<{ href: string; section: string }> }
/** One poll = the frames of the page at that moment. The last poll repeats. `onPoll` may close the window etc. */
interface Scenario { polls: FrameData[][]; onPoll?: (i: number, f: FakeBrowser) => void; requests?: Array<{ url: string; type: string }> }

const BEFORE = [
  'Softwareentwickler (m/w/d)', 'Beispiel GmbH', 'Informationen zur Bewerbung', 'Sicherheitsabfrage',
  'Bitte bestätigen Sie, dass Sie kein Roboter sind.', 'Service der Bundesagentur: Telefon 0800 4 5555 00',
].join('\n');
const AFTER_CONTACT = [
  'Softwareentwickler (m/w/d)', 'Beispiel GmbH', 'Informationen zur Bewerbung', 'Kontaktadresse', 'Beispiel Personal GmbH',
  'Erika Musterfrau', 'E-Mail: erika.musterfrau@example.de', 'Bewerben Sie sich:', 'Über Internetseite des Arbeitgebers',
  'Bitte bewerben Sie sich unter Angabe unserer internen Stellennummer: JN -1234567', 'Service der Bundesagentur: Telefon 0800 4 5555 00',
].join('\n');
const AFTER_LINK_ONLY = [
  'Softwareentwickler (m/w/d)', 'Beispiel GmbH', 'Informationen zur Bewerbung', 'Bewerben Sie sich:',
  'Über Internetseite des Arbeitgebers', 'Service der Bundesagentur: Telefon 0800 4 5555 00',
].join('\n');
const HOME = { href: 'https://www.beispiel.example/', section: 'Webseiten' };
const AA_LINK = { href: 'https://www.arbeitsagentur.de/hilfe', section: 'Hilfe' };
const APPLY = { href: 'https://karriere.beispiel.example/stelle/42', section: 'Informationen zur Bewerbung' };

class FakeFrame {
  constructor(private readonly data: FrameData, readonly log: string[]) {}
  url() { return this.data.url ?? 'https://www.arbeitsagentur.de/jobsuche/jobdetail/x'; }
  async evaluate(script: string) {
    if (script === READ_FRAME_SCRIPT) return { text: this.data.text, hrefs: this.data.hrefs ?? [], links: this.data.links ?? [] };
    if (script === COOKIE_SCRIPT) { this.log.push('cookie'); return 'Auswahl bestätigen'; }
    if (script === SCROLL_SCRIPT) { this.log.push('scroll'); return true; }
    throw new Error('unknown script');
  }
}

class FakePage extends EventEmitter {
  gotoUrls: string[] = [];
  handled: Array<{ url: string; outcome: string }> = [];
  private poll = 0;
  constructor(private readonly s: Scenario, private readonly b: FakeBrowser) { super(); }
  target() { return this; }
  async setRequestInterception() {}
  async goto(url: string) {
    this.gotoUrls.push(url);
    for (const r of this.s.requests ?? []) {
      await new Promise<void>((resolve) => {
        this.emit('request', {
          url: () => r.url, resourceType: () => r.type,
          continue: async () => { this.handled.push({ url: r.url, outcome: 'continue' }); resolve(); },
          abort: async (why: string) => { this.handled.push({ url: r.url, outcome: `abort:${why}` }); resolve(); },
        });
      });
    }
    return { ok: () => true, status: () => 200 };
  }
  async waitForNetworkIdle() {}
  mainFrame() { return new FakeFrame({ text: '' }, this.b.log); }
  frames() {
    const i = this.poll++;
    this.s.onPoll?.(i, this.b);
    const frames = this.s.polls[Math.min(i, this.s.polls.length - 1)] ?? [];
    return frames.map((d) => new FakeFrame(d, this.b.log));
  }
}

class FakeBrowser extends EventEmitter {
  log: string[] = [];
  closed = 0;
  page: FakePage;
  constructor(s: Scenario) { super(); this.page = new FakePage(s, this); }
  target() { return { createCDPSession: async () => ({ send: async (m: string, p: unknown) => { this.log.push(`${m}:${JSON.stringify(p)}`); } }) }; }
  async pages() { return [this.page]; }
  async newPage() { return this.page; }
  async close() { this.closed++; }
  process() { return null; }
  /** The person closes the window. */
  closeWindow() { this.page.emit('close'); this.emit('disconnected'); }
}

let tmpRoots: string[] = [];
afterEach(() => { for (const d of tmpRoots) fs.rmSync(d, { recursive: true, force: true }); tmpRoots = []; });

function setup(s: Scenario, extra: Partial<ConstructorParameters<typeof AaContactWindow>[0]> = {}) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-contact-test-'));
  tmpRoots.push(tmpRoot);
  const browser = new FakeBrowser(s);
  const launch = vi.fn<(o: ReturnType<typeof contactLaunchOptions>) => Promise<Browser>>(async () => browser as unknown as Browser);
  const log = vi.fn();
  const win = new AaContactWindow({ tmpRoot, find: () => 'C:/edge.exe', check: publicCheck, launch, log, pollMs: 5, settleMs: 0, timeoutMs: 2000, ...extra });
  return { win, browser, launch, log, tmpRoot };
}
const run = (win: AaContactWindow, refnr = REFNR) => win.readContact(refnr, new AbortController().signal);

describe('contactLaunchOptions', () => {
  it('visible window, own profile, popup blocker kept on, new windows blocked', () => {
    const o = contactLaunchOptions('C:/edge.exe', 'C:/tmp/pdf-contact-1', 30_000);
    expect(o.headless).toBe(false);
    expect(o.userDataDir).toBe('C:/tmp/pdf-contact-1');
    expect(o.ignoreDefaultArgs).toContain('--disable-popup-blocking');
    expect(o.args).toContain('--block-new-web-contents');
  });
});

describe('AaContactWindow', () => {
  it('opens only the jobdetail page of the Referenznummer, clicks the cookie banner, scrolls, denies downloads', async () => {
    const { win, browser, launch } = setup({ polls: [[{ text: BEFORE }], [{ text: AFTER_CONTACT }]] });
    await run(win);
    expect(browser.page.gotoUrls).toEqual([`https://www.arbeitsagentur.de/jobsuche/jobdetail/${REFNR}`]);
    expect(launch.mock.calls[0][0].headless).toBe(false);
    expect(browser.log).toContain('cookie');
    expect(browser.log.indexOf('cookie')).toBeLessThan(browser.log.indexOf('scroll'));
    expect(browser.log).toContain('Browser.setDownloadBehavior:{"behavior":"deny"}');
  });

  it('a contact found after a few polls: returns the page text once it reads the same twice in a row, closes the window', async () => {
    const { win, browser, log, tmpRoot } = setup({ polls: [[{ text: BEFORE }], [{ text: BEFORE }], [{ text: BEFORE }], [{ text: AFTER_CONTACT }]] });
    const r = await run(win);
    expect(r).toMatchObject({ text: expect.stringContaining('erika.musterfrau@example.de') });
    expect(browser.closed).toBeGreaterThan(0);
    expect(log).toHaveBeenCalledWith('vacancy.contactFind', { source: 'aa', result: 'ok' });
    expect(JSON.stringify(log.mock.calls)).not.toContain('example.de');
    // The temporary profile is gone.
    expect(fs.readdirSync(tmpRoot).filter((n) => n.startsWith('pdf-contact-'))).toEqual([]);
  });

  it('a mailto: link that appears counts as the contact (and reaches the text as "E-Mail:")', async () => {
    const { win } = setup({ polls: [[{ text: BEFORE }], [{ text: AFTER_LINK_ONLY.replace('Über', 'Per Mail. Über'), hrefs: ['mailto:jobs@beispiel.example?subject=x'] }]] });
    const r = await run(win);
    expect(r).toMatchObject({ text: expect.stringContaining('E-Mail: jobs@beispiel.example') });
  });

  it('data already in the first read (footer hotline) never counts as a contact', async () => {
    const clock = (i: number) => `${BEFORE}\nStand: 10:0${i % 10}`;
    const { win, log } = setup({ polls: Array.from({ length: 30 }, (_, i) => [{ text: clock(i), hrefs: ['tel:0800455500'] }]) }, { timeoutMs: 150 });
    await expect(run(win)).rejects.toMatchObject({ code: 'BAD_REQUEST', reason: 'contactTimeout' });
    expect(log).toHaveBeenCalledWith('vacancy.contactFind', { source: 'aa', result: 'timeout' });
  });

  it('link-only offer: once the block is revealed and stable, returns the new links off the AA site (no e-mail, no phone)', async () => {
    const { win, log } = setup({
      polls: [
        [{ text: BEFORE, links: [HOME, AA_LINK] }],
        [{ text: AFTER_LINK_ONLY, links: [HOME, AA_LINK, APPLY] }],
      ],
    });
    const r = await run(win);
    expect(r).toEqual({ text: expect.stringContaining('Über Internetseite des Arbeitgebers'), links: [APPLY.href] });
    // The AA service number was there before the captcha: it never reaches the parser as the employer's phone.
    expect(r).toMatchObject({ text: expect.not.stringContaining('Service der Bundesagentur') });
    expect(log).toHaveBeenCalledWith('vacancy.contactFind', { source: 'aa', result: 'none' });
  });

  it('withoutAaService drops only the AA service number and AA e-mail lines', () => {
    const now = [
      'Beispiel GmbH', 'Bewerbungen an bewerbung@beispiel.example', 'Telefon 0800 4 5555 00', 'Arbeitgeber-Service: +49 800 4555520',
      'Fragen: service@arbeitsagentur.de', 'Tel. 0351 1234567',
    ].join('\n');
    expect(withoutAaService(now)).toBe('Beispiel GmbH\nBewerbungen an bewerbung@beispiel.example\nTel. 0351 1234567');
  });

  it('an employer e-mail already in the offer description is kept when the block reveals only a link', async () => {
    const desc = 'Bewerbungen bitte an bewerbung@beispiel.example';
    const { win, log } = setup({ polls: [[{ text: `${desc}\n${BEFORE}`, links: [HOME] }], [{ text: `${desc}\n${AFTER_LINK_ONLY}`, links: [HOME, APPLY] }]] });
    const r = await run(win);
    expect(r).toMatchObject({ text: expect.stringContaining('bewerbung@beispiel.example'), links: [APPLY.href] });
    expect(log).toHaveBeenCalledWith('vacancy.contactFind', { source: 'aa', result: 'ok' });
  });

  it('an offer that shows the contact block without any captcha finishes, but only after the no-captcha wait', async () => {
    const { win } = setup({ polls: [[{ text: AFTER_CONTACT }]] }, { noCaptchaWaitMs: 80 });
    const started = Date.now();
    await expect(run(win)).resolves.toMatchObject({ text: expect.stringContaining('erika.musterfrau@example.de') });
    expect(Date.now() - started).toBeGreaterThanOrEqual(80);
  });

  it('a contact in the description + a late captcha: the window waits for the captcha and the real block', async () => {
    const desc = 'Fragen gern an info@beispiel.example\nBewerben Sie sich: über unser Portal';
    const plain = `${desc}\nSoftwareentwickler (m/w/d)\nInformationen zur Bewerbung`;
    const polls: FrameData[][] = [
      ...Array.from({ length: 5 }, () => [{ text: plain }]),
      ...Array.from({ length: 10 }, () => [{ text: `${desc}\n${BEFORE}` }]),
      [{ text: `${desc}\n${AFTER_CONTACT}` }],
    ];
    const { win } = setup({ polls }, { noCaptchaWaitMs: 300 });
    await expect(run(win)).resolves.toMatchObject({ text: expect.stringContaining('erika.musterfrau@example.de') });
  });

  it('without a captcha, a contact only in the description never ends the window (the block must hold it)', async () => {
    const desc = 'Fragen gern an info@beispiel.example';
    const { win } = setup({ polls: [[{ text: `${desc}\n${AFTER_LINK_ONLY.replace('Bewerben Sie sich:', 'Bewerbung:')}` }]] }, { noCaptchaWaitMs: 10, timeoutMs: 150 });
    await expect(run(win)).rejects.toMatchObject({ reason: 'contactTimeout' });
  });

  it('applicationBlock: from the application heading to the next section', () => {
    const page = 'Beschreibung\nmail@beispiel.example\nInformationen zur Bewerbung\nKontaktadresse\nE-Mail: a@b.example\nWebseiten\nHomepage';
    expect(applicationBlock(page)).toBe('\nKontaktadresse\nE-Mail: a@b.example\n');
    expect(applicationBlock('kein Block')).toBe('');
  });

  it('a malformed mailto: link is skipped, not fatal', async () => {
    const { win } = setup({ polls: [[{ text: BEFORE, hrefs: ['mailto:%E0%A4%A'] }], [{ text: AFTER_CONTACT, hrefs: ['mailto:%E0%A4%A'] }]] });
    await expect(run(win)).resolves.toMatchObject({ text: expect.stringContaining('erika.musterfrau@example.de') });
  });

  it('a browser that never finishes closing is killed, and the next window still opens', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-contact-test-'));
    tmpRoots.push(tmpRoot);
    const kill = vi.fn();
    const launch = vi.fn(async () => {
      const b = new FakeBrowser({ polls: [[{ text: BEFORE }], [{ text: AFTER_CONTACT }]] });
      b.close = () => new Promise<void>(() => undefined);
      (b as unknown as { process: () => unknown }).process = () => ({ kill });
      return b as unknown as Browser;
    });
    const win = new AaContactWindow({ tmpRoot, find: () => 'C:/edge.exe', check: publicCheck, launch, pollMs: 5, settleMs: 0, timeoutMs: 2000, closeTimeoutMs: 20 });
    await run(win);
    await run(win);
    expect(launch).toHaveBeenCalledTimes(2);
    expect(kill).toHaveBeenCalledTimes(2);
  });

  it('link-only offer without a new link: falls back to links in the application section, at most 3', async () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ href: `https://jobs${i}.beispiel.example/`, section: 'Informationen zur Bewerbung' }));
    const { win } = setup({ polls: [[{ text: BEFORE, links: [HOME, ...many] }], [{ text: AFTER_LINK_ONLY, links: [HOME, ...many] }]] });
    const r = await run(win);
    expect(r).toMatchObject({ links: many.slice(0, 3).map((l) => l.href) });
  });

  it('the captcha disappearing counts as revealed even when "Bewerben Sie sich" was already on the page', async () => {
    const before = `${BEFORE}\nBewerben Sie sich:`;
    const after = AFTER_LINK_ONLY;
    const { win } = setup({ polls: [[{ text: before }], [{ text: after }]] });
    await expect(run(win)).resolves.toMatchObject({ links: [] });
  });

  it('the person closes the window → cancelled (no error), logged as cancelled', async () => {
    const { win, log } = setup({ polls: [[{ text: BEFORE }]], onPoll: (i, b) => { if (i === 2) b.closeWindow(); } });
    await expect(run(win)).resolves.toEqual({ cancelled: true });
    expect(log).toHaveBeenCalledWith('vacancy.contactFind', { source: 'aa', result: 'cancelled' });
  });

  it('5 minutes without a contact → contactTimeout', async () => {
    const { win } = setup({ polls: [[{ text: BEFORE }]] }, { timeoutMs: 60 });
    await expect(run(win)).rejects.toMatchObject({ reason: 'contactTimeout' });
  });

  it('stopped from outside → cancelledByUser', async () => {
    const { win } = setup({ polls: [[{ text: BEFORE }]] });
    const ac = new AbortController();
    const p = win.readContact(REFNR, ac.signal);
    setTimeout(() => ac.abort(), 30);
    await expect(p).rejects.toMatchObject({ code: 'LLM_CANCELLED', reason: 'cancelledByUser' });
  });

  it('requests: private addresses are refused, pictures and fonts allowed when public', async () => {
    const check: Check = async (u) => {
      if (u.includes('dns-fails')) throw new Error('lookup failed');
      return u.includes('10.0.0.1') ? { ok: false, why: 'private' } : { ok: true };
    };
    const { win, browser } = setup({
      polls: [[{ text: BEFORE }], [{ text: AFTER_CONTACT }]],
      requests: [{ url: 'http://10.0.0.1/x', type: 'xhr' }, { url: 'https://dns-fails.example/x', type: 'script' },{ url: 'https://cdn.example/captcha.png', type: 'image' }, { url: 'https://cdn.example/f.woff2', type: 'font' }, { url: 'data:image/png;base64,AA', type: 'image' }],
    }, { check });
    await run(win);
    expect(browser.page.handled).toEqual([
      { url: 'http://10.0.0.1/x', outcome: 'abort:blockedbyclient' },
      { url: 'https://dns-fails.example/x', outcome: 'abort:blockedbyclient' },
      { url: 'https://cdn.example/captcha.png', outcome: 'continue' },
      { url: 'https://cdn.example/f.woff2', outcome: 'continue' },
      { url: 'data:image/png;base64,AA', outcome: 'continue' },
    ]);
  });

  it('an answer from an internal address ends the window as blocked; nothing is used', async () => {
    const { win, log } = setup({
      polls: [[{ text: BEFORE }], [{ text: AFTER_CONTACT }]],
      onPoll: (i, b) => { if (i === 0) b.page.emit('response', { remoteAddress: () => ({ ip: '10.0.0.5' }) }); },
    });
    await expect(run(win)).rejects.toMatchObject({ code: 'BAD_REQUEST', reason: 'pageUnreadable' });
    expect(log).toHaveBeenCalledWith('vacancy.contactFind', { source: 'aa', result: 'blocked' });
  });

  it('a popup window is closed right away', async () => {
    const popupClose = vi.fn(async () => undefined);
    const { win } = setup({
      polls: [[{ text: BEFORE }], [{ text: AFTER_CONTACT }]],
      onPoll: (i, b) => { if (i === 0) b.emit('targetcreated', { type: () => 'page', page: async () => ({ close: popupClose }) }); },
    });
    await run(win);
    expect(popupClose).toHaveBeenCalled();
  });

  it('one window at a time: the second waits until the first is done', async () => {
    let active = 0;
    let maxActive = 0;
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-contact-test-'));
    tmpRoots.push(tmpRoot);
    const launch = vi.fn(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      const b = new FakeBrowser({ polls: [[{ text: BEFORE }], [{ text: AFTER_CONTACT }]] });
      b.close = async () => { active--; };
      return b as unknown as Browser;
    });
    const win = new AaContactWindow({ tmpRoot, find: () => 'C:/edge.exe', check: publicCheck, launch, pollMs: 5, settleMs: 0, timeoutMs: 2000 });
    await Promise.all([run(win), run(win)]);
    expect(launch).toHaveBeenCalledTimes(2);
    expect(maxActive).toBe(1);
  });

  it('no Edge or Chrome → BROWSER_MISSING; a bad Referenznummer → BAD_REQUEST before any browser', async () => {
    const launch = vi.fn();
    const noBrowser = new AaContactWindow({ tmpRoot: '.', find: () => null, launch });
    await expect(run(noBrowser)).rejects.toMatchObject({ code: 'BROWSER_MISSING' });
    const win = new AaContactWindow({ tmpRoot: '.', find: () => 'C:/edge.exe', launch });
    await expect(run(win, '-x/../y')).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(run(win, 'https://evil.example/')).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(launch).not.toHaveBeenCalled();
  });
});
