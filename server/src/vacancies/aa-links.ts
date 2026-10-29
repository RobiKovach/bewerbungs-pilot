// Links of Arbeitsagentur offers. No imports on purpose: the schema migrations use these too, and the source module
// imports the schema (a cycle would leave one of them half-initialised).

export function jobdetailUrl(refnr: string): string {
  return `https://www.arbeitsagentur.de/jobsuche/jobdetail/${encodeURIComponent(refnr)}`;
}

const hostOf = (url: string): string | null => {
  try {
    const u = new URL(url.trim());
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.hostname.toLowerCase().replace(/\.$/, '') : null;
  } catch {
    return null;
  }
};

/** arbeitsagentur.de or any of its subdomains (http/https only). */
export function isAaHost(url: string): boolean {
  const host = hostOf(url);
  return host !== null && (host === 'arbeitsagentur.de' || host.endsWith('.arbeitsagentur.de'));
}

/**
 * The partner page of an offer, or '' (0.9.1): only an http(s) link that is not the Arbeitsagentur itself — the API
 * often sets `allianzpartnerUrl` to just "http://www.arbeitsagentur.de", which is not a page about the offer.
 */
export function partnerLink(raw: string, maxLength: number): string {
  const url = raw.trim();
  if (!url || url.length > maxLength || hostOf(url) === null || isAaHost(url)) return '';
  return url;
}
