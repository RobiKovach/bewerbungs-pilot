import type { DocLanguage } from '@bp/shared';

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const EN_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad = (n: number) => String(n).padStart(2, '0');

/** Local calendar date: the letter is dated the day it is printed. */
export function formatDate(d: Date, lang: DocLanguage): string {
  return lang === 'en' ? `${d.getDate()} ${EN_MONTHS[d.getMonth()]} ${d.getFullYear()}` : `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

/** "YYYY-MM" → "MM/YYYY", "YYYY" stays. */
const ym = (v: string) => { const [y, m] = v.split('-'); return m ? `${m}/${y}` : (y ?? ''); };

export function dateRange(from: string, to: string, lang: DocLanguage): string {
  if (!from && !to) return '';
  const end = to ? ym(to) : lang === 'en' ? 'present' : 'heute';
  if (from && to && from === to) return ym(from);
  return from ? `${ym(from)} – ${end}` : end;
}

const UMLAUTS: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'Ae', Ö: 'Oe', Ü: 'Ue', ß: 'ss', ł: 'l', Ł: 'L', đ: 'd', Đ: 'D', ø: 'o', Ø: 'O' };

/** Latin letters, digits and "-" only; everything else becomes "_" (never leading/trailing/double). */
export function asciiName(s: string): string {
  return s.replace(/[äöüÄÖÜßłŁđĐøØ]/g, (c) => UMLAUTS[c] ?? c)
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
}

/** Download and email attachment names, in the document's language (DE Anschreiben/Lebenslauf, EN Cover_Letter/CV). */
export function fileNames(fullName: string, company: string, language: DocLanguage): { letter: string; cv: string; bundle: string } {
  const name = asciiName(fullName);
  const firm = asciiName(company);
  const join = (...parts: string[]) => `${parts.filter(Boolean).join('_')}.pdf`;
  if (language === 'en') return { letter: join('Cover_Letter', name, firm), cv: join('CV', name), bundle: join('Application', name, firm) };
  return { letter: join('Anschreiben', name, firm), cv: join('Lebenslauf', name), bundle: join('Bewerbung', name, firm) };
}

/** The page frame every template shares: A4, no margins from the browser, one inline stylesheet, no scripts. */
export function page(lang: DocLanguage, title: string, css: string, body: string): string {
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>@page{size:A4;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0}body{font-family:Calibri,Arial,sans-serif;color:#1d1d1f;-webkit-print-color-adjust:exact;print-color-adjust:exact}${css}</style></head><body>${body}</body></html>`;
}
