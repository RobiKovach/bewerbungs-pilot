import type { ResearchSource } from '@bp/shared';
import type { PageLink } from '../vacancies/sources/page-reader.js';

/**
 * Company research (0.13.0, spec 4.2 steps 2–3): which links of a read page lead to the company's own site and to its
 * Impressum / contact / job pages. Pure functions — no network. Links with a login (`user:pass@`) or a scheme other
 * than http(s) are never returned.
 */

export type PageKind = ResearchSource['kind'];

/** Hosted application systems: their job pages hold the contact, but they are never the company's own site. */
export const APPLY_SERVICES: string[] = [
  'jobs.personio.de', 'personio.de', 'softgarden.io', 'softgarden.de', 'myworkdayjobs.com', 'smartrecruiters.com',
  'greenhouse.io', 'lever.co', 'empfehlungsbund.de', 'dvinci-hr.com', 'onlyfy.jobs', 'join.com', 'recruitee.com',
];

/** Job boards: the vacancy is listed there, but the company lives elsewhere. */
export const JOB_BOARDS: string[] = [
  'stepstone.de', 'indeed.com', 'indeed.de', 'itsax.de', 'get-in-it.de', 'remotely.de', 'jobvector.de', 'jobijoba.de',
  'jooble.org', 'jobleads.com', 'wearedevelopers.com', 'xing.com', 'linkedin.com', 'arbeitsagentur.de', 'monster.de', 'kimeta.de',
];

/** Social networks, maps, fonts, counters, consent tools, review sites: never a company site. `name.*` = any TLD. */
export const IGNORED_HOSTS: string[] = [
  'google.*', 'googleapis.com', 'gstatic.com', 'googletagmanager.com', 'google-analytics.com', 'doubleclick.net', 'goo.gl',
  'apple.com', 'play.google.com', 'cookiebot.com', 'usercentrics.eu', 'onetrust.com', 'consentmanager.net',
  'youtube.com', 'youtu.be', 'vimeo.com', 'facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'tiktok.com',
  'pinterest.com', 'whatsapp.com', 't.me', 'openstreetmap.org', 'bing.com', 'hotjar.com', 'matomo.cloud', 'etracker.com',
  'kununu.com', 'glassdoor.*', 'wikipedia.org',
];

/** Mail providers anyone can use: their domain says nothing about the company. */
export const FREE_MAIL: string[] = [
  'gmail.com', 'googlemail.com', 'gmx.de', 'gmx.net', 'web.de', 't-online.de', 'outlook.com', 'hotmail.com', 'yahoo.com',
  'yahoo.de', 'icloud.com', 'posteo.de', 'mail.de', 'freenet.de',
];

/** Names that are no company (agency placeholders): no domain guess, no news query. */
const GENERIC_NAMES = new Set(['personalvermittlung', 'arbeitgeber', 'unternehmen', 'firma', 'anonym', 'vertraulich']);

const LEGAL_FORM = /\b(?:gmbh\s*&\s*co\.?\s*kgaa|gmbh\s*&\s*co\.?\s*kg|ug\s*\(haftungsbeschr(?:ä|ae)nkt\)|gmbh|mbh|ag|se|kg|ug|e\.\s?v\.?)(?=\s|$|[,.;)])/giu;

/** Kinds in the order pages are read (spec 4.2 step 3). */
const KIND_ORDER: PageKind[] = ['impressum', 'contact', 'apply', 'careers', 'about'];
const KIND_RULES: Array<[PageKind, RegExp]> = [
  ['impressum', /impressum|imprint|legal[\s_-]*notice/],
  ['contact', /kontakt|contact/],
  ['apply', /\bbewerb|\bapply\b/],
  ['careers', /\bkarriere|\bcareers?\b|\bjobs?\b|\bstellen/],
  ['about', /über[\s_-]*uns|ueber[\s_-]*uns|\babout\b|\bunternehmen\b/],
];

const MAX_CANDIDATES = 6;

function hostMatches(host: string, list: string[]): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  return list.some((entry) => {
    if (entry.endsWith('.*')) {
      // `google.*`: some label "google" followed by one or two short labels (google.de, google.co.uk).
      const name = entry.slice(0, -2);
      const labels = h.split('.');
      const at = labels.lastIndexOf(name);
      return at >= 0 && labels.length - at - 1 >= 1 && labels.length - at - 1 <= 2;
    }
    return h === entry || h.endsWith(`.${entry}`);
  });
}

export const isBoard = (host: string): boolean => hostMatches(host, JOB_BOARDS);
export const isApplyService = (host: string): boolean => hostMatches(host, APPLY_SERVICES);
export const isIgnored = (host: string): boolean => hostMatches(host, IGNORED_HOSTS);

/** A plain http(s) URL without a login, or null. */
function webUrl(raw: string): URL | null {
  if (!URL.canParse(raw)) return null;
  const u = new URL(raw);
  if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.username !== '' || u.password !== '' || !u.hostname) return null;
  return u;
}

/** The site key used for comparisons: `https://host` without a leading `www.`; '' for anything else. */
export function siteOf(url: string): string {
  const u = webUrl(url);
  return u ? `https://${u.hostname.toLowerCase().replace(/^www\./, '')}` : '';
}

/** The address as a site to open: scheme and host only (port kept). */
const originOf = (u: URL) => `${u.protocol}//${u.host.toLowerCase()}`;

export function pageKind(link: PageLink): PageKind | null {
  const hay = `${link.text} ${link.href}`.toLowerCase();
  for (const [kind, rule] of KIND_RULES) if (rule.test(hay)) return kind;
  return null;
}

/** The name without its legal form (and dangling "&", commas), whitespace collapsed, lower case. */
function coreName(company: string): string {
  return company.toLowerCase().replace(LEGAL_FORM, ' ').replace(/\s+/g, ' ').replace(/^[\s&,.-]+|[\s&,.-]+$/g, '').trim();
}

const UMLAUTS: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' };

export function companySlugs(company: string): string[] {
  const core = coreName(company).replace(/[äöüß]/g, (c) => UMLAUTS[c] ?? c);
  const words = core.split(/[^a-z0-9]+/).filter((w) => w !== '');
  const joined = words.join('');
  if ((joined.match(/[a-z]/g) ?? []).length < 3 || GENERIC_NAMES.has(joined)) return [];
  return words.length > 1 ? [words.join('-'), joined] : [joined];
}

export function nameOnPage(company: string, text: string): boolean {
  const core = coreName(company);
  if (companySlugs(company).length === 0 || core.length < 3) return false;
  return text.toLowerCase().replace(/\s+/g, ' ').includes(core);
}

/**
 * Where the company's own site may be, best first (spec 4.2 step 2): 1) a link from a job board or an apply service
 * to another, not ignored host; 2) the domain of a non-free e-mail; 3) the page itself when it is neither a board nor
 * an apply service; 4) guesses from the name (`https://www.<slug>.de`, `.com`) — the caller accepts a guess only when
 * the opened page names the company (`nameOnPage`). No repeats (compared without `www.`), at most 6.
 */
export function websiteCandidates(input: { pageUrl: string; links: PageLink[]; emails: string[]; company: string }): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (site: string) => {
    const key = siteOf(site);
    if (!key || seen.has(key) || out.length >= MAX_CANDIDATES) return;
    seen.add(key);
    out.push(site);
  };
  const page = webUrl(input.pageUrl);
  const pageHost = page?.hostname ?? '';
  const pageIsListing = page !== null && (isBoard(pageHost) || isApplyService(pageHost));

  if (pageIsListing) {
    for (const l of input.links) {
      const u = webUrl(l.href);
      if (!u) continue;
      const h = u.hostname;
      if (siteOf(l.href) === siteOf(input.pageUrl) || isBoard(h) || isApplyService(h) || isIgnored(h)) continue;
      add(originOf(u));
    }
  }
  for (const email of input.emails) {
    const domain = email.trim().toLowerCase().split('@')[1] ?? '';
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) continue;
    if (hostMatches(domain, FREE_MAIL) || isBoard(domain) || isApplyService(domain) || isIgnored(domain)) continue;
    add(`https://${domain}`);
  }
  if (page && !pageIsListing && !isIgnored(pageHost)) add(originOf(page));
  for (const slug of companySlugs(input.company)) {
    add(`https://www.${slug}.de`);
    add(`https://www.${slug}.com`);
  }
  return out;
}

/**
 * The next pages to read on the company site, by kind (Impressum → contact → apply → careers → about). Same site
 * (without `www.`), or a job page (apply/careers) on an apply service — never the service's own Impressum, contact
 * or about pages, which describe the service, not the company. `#…` is dropped; addresses in `seen` are skipped.
 */
export function nextPages(site: string, links: PageLink[], seen: Set<string>): Array<{ url: string; kind: PageKind }> {
  const own = siteOf(site);
  const picked = new Map<string, PageKind>();
  for (const l of links) {
    const u = webUrl(l.href);
    if (!u || isIgnored(u.hostname)) continue;
    u.hash = '';
    const url = u.toString();
    if (seen.has(url) || picked.has(url)) continue;
    const kind = pageKind(l);
    if (!kind) continue;
    const sameSite = own !== '' && siteOf(url) === own;
    const jobOnService = isApplyService(u.hostname) && (kind === 'apply' || kind === 'careers');
    if (sameSite || jobOnService) picked.set(url, kind);
  }
  return [...picked].map(([url, kind]) => ({ url, kind })).sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
}
