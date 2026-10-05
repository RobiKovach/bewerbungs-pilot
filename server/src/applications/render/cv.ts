import type { ApplicationPackage, DocLanguage } from '@bp/shared';
import { dateRange, escapeHtml as e, page } from './html.js';

const LABELS: Record<DocLanguage, { title: string; profil: string; experience: string; education: string; training: string; skills: string; languages: string; contact: string; address: string; phone: string; email: string }> = {
  de: { title: 'Lebenslauf', profil: 'Profil', experience: 'Berufserfahrung', education: 'Ausbildung', training: 'Weiterbildung & Zertifikate', skills: 'Kenntnisse', languages: 'Sprachen', contact: 'Kontakt', address: 'Adresse', phone: 'Telefon', email: 'E-Mail' },
  en: { title: 'Curriculum Vitae', profil: 'Profile', experience: 'Work experience', education: 'Education', training: 'Further training & certificates', skills: 'Skills', languages: 'Languages', contact: 'Contact', address: 'Address', phone: 'Phone', email: 'E-mail' },
};
const NATIVE: Record<DocLanguage, string> = { de: 'Muttersprache', en: 'Native' };
const TRAINING_KINDS = new Set(['course', 'certificate']);

// Two columns like the example: the left column (photo, name, headline, contacts, skills, languages) comes first in the
// HTML, because that is its reading order for text extraction (ATS); the grid places it on the left.
const CSS = `.cv{width:210mm;min-height:297mm;display:grid;grid-template-columns:74mm 1fr;grid-template-areas:"side main";background:linear-gradient(to right,#2f5d62 0,#2f5d62 74mm,#fff 74mm);font-size:10pt;line-height:1.4;color:#222}
.side{grid-area:side;color:#fff;padding:14mm 10mm 12mm}
.photo{display:block;width:36mm;height:36mm;border-radius:50%;object-fit:cover;object-position:center 30%;margin:0 auto 8mm;border:3px solid rgba(255,255,255,.25)}
.side h1{font-size:20pt;font-weight:700;margin:0;line-height:1.15}
.side .headline{font-size:11pt;color:#cfe0e0;margin:1mm 0 5mm}
.side h2{font-size:9.5pt;text-transform:uppercase;letter-spacing:.05em;font-weight:700;margin:6mm 0 2.5mm;padding-bottom:1mm;border-bottom:1px solid rgba(255,255,255,.35)}
.side .item{margin-bottom:2.5mm}
.side .label{display:block;font-size:7.5pt;text-transform:uppercase;letter-spacing:.05em;color:#a9c6c6}
.side .value{font-size:9.5pt;word-break:break-word}
.side .group{margin-bottom:2.5mm}
.side .group strong{display:block;font-size:9.5pt}
.side .group span{font-size:9pt;color:#d7e6e6}
.side .row{display:flex;justify-content:space-between;gap:3mm;font-size:9.5pt;margin-bottom:1.5mm}
.side .row span:last-child{color:#b9d4d4;text-align:right}
.main{grid-area:main;padding:14mm 13mm 12mm}
.main h2{font-size:13pt;color:#2f5d62;font-weight:700;border-bottom:2px solid #2f5d62;padding-bottom:1mm;margin:0 0 3mm}
.main section{margin-bottom:6mm}
.main .profil{text-align:justify;line-height:1.5;margin:0}
.entry{display:grid;grid-template-columns:28mm 1fr;gap:3mm;margin-bottom:3mm;break-inside:avoid}
.entry .when{font-weight:700;color:#2f5d62;white-space:nowrap}
.entry .what strong{display:block}
.entry .what .where{color:#555}
.entry .what p{margin:1mm 0 0}`;

export function cvHtml(p: ApplicationPackage, photo: { data: Buffer; ext: '.jpg' | '.png' } | null): string {
  const lang = p.language;
  const t = LABELS[lang];
  const s = p.snapshot;
  const personal = s.personal;
  const desc = (id: string, fallback: string) => (p.cv.descriptions[id] ?? fallback).trim();
  const tr = (v: string) => p.cv.translations[v.trim()] ?? v;
  const where = (org: string, city: string, country: string) =>
    [org, [city, country ? tr(country) : ''].map((x) => x.trim()).filter(Boolean).join(', ')].filter(Boolean).join(' · ');

  const contactItems: [string, string][] = [
    [t.address, [personal.street, [personal.postalCode, personal.city].filter(Boolean).join(' ')].map((x) => x.trim()).filter(Boolean).join(', ')],
    [t.phone, personal.phone.trim()],
    [t.email, personal.email.trim()],
    ...personal.links.map((l): [string, string] => [l.label, l.url.replace(/^https?:\/\//, '').replace(/\/$/, '')]),
  ];
  const contact = contactItems.filter(([, v]) => v).map(([k, v]) => `<div class="item"><span class="label">${e(k)}</span><span class="value">${e(v)}</span></div>`).join('');

  const entry = (id: string, from: string, to: string, title: string, org: string, city: string, country: string, text: string) => {
    const d = desc(id, text);
    return `<div class="entry"><div class="when">${e(dateRange(from, to, lang))}</div><div class="what"><strong>${e(title)}</strong><span class="where">${e(where(org, city, country))}</span>${d ? `<p>${e(d)}</p>` : ''}</div></div>`;
  };
  const experience = s.experience.map((x) => entry(x.id, x.from, x.to, x.jobTitle, x.employer, x.city, x.country, x.description)).join('');
  const entries = (list: typeof s.education) => list.map((x) => entry(x.id, x.from, x.to, x.degree, x.institution, x.city, x.country, x.description)).join('');
  const schooling = entries(s.education.filter((x) => !TRAINING_KINDS.has(x.kind)));
  const training = entries(s.education.filter((x) => TRAINING_KINDS.has(x.kind)));

  const byId = new Map(s.skills.map((k) => [k.id, k.name]));
  // Skills no group lists (e.g. a migrated v1 package with a partial skillOrder) follow as one unnamed group.
  const grouped = new Set(p.cv.skillGroups.flatMap((g) => g.skillIds));
  const rest = s.skills.filter((k) => !grouped.has(k.id)).map((k) => k.id);
  const groups = [...p.cv.skillGroups, { name: '', skillIds: rest }].map((g) => {
    const names = g.skillIds.map((id) => byId.get(id)).filter((n): n is string => !!n);
    return names.length ? `<div class="group">${g.name.trim() ? `<strong>${e(g.name)}</strong>` : ''}<span>${e(names.join(', '))}</span></div>` : '';
  }).join('');
  const languages = s.languages.map((l) => `<div class="row"><span>${e(tr(l.language))}</span><span>${e([l.level === 'native' ? NATIVE[lang] : l.level, l.certificate.trim()].filter(Boolean).join(', '))}</span></div>`).join('');

  const section = (title: string, html: string) => (html ? `<section><h2>${e(title)}</h2>${html}</section>` : '');
  const img = photo ? `<img class="photo" alt="" src="data:image/${photo.ext === '.png' ? 'png' : 'jpeg'};base64,${photo.data.toString('base64')}">` : '';
  const body = `<div class="cv">
<aside class="side">${img}<h1>${e(personal.fullName)}</h1>${p.cv.headline.trim() ? `<div class="headline">${e(p.cv.headline)}</div>` : ''}
${contact ? `<h2>${t.contact}</h2>${contact}` : ''}${groups ? `<h2>${t.skills}</h2>${groups}` : ''}${languages ? `<h2>${t.languages}</h2>${languages}` : ''}</aside>
<main class="main">
${p.cv.profil.trim() ? `<section><h2>${t.profil}</h2><p class="profil">${e(p.cv.profil)}</p></section>` : ''}
${section(t.experience, experience)}${section(t.education, schooling)}${section(t.training, training)}
</main></div>`;
  return page(lang, `${t.title} ${personal.fullName}`, CSS, body);
}
