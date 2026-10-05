import type { ApplicationPackage, DocLanguage, LanguageLevel, SkillLevel } from '@bp/shared';
import { dateRange, escapeHtml as e, page } from './html.js';

const LABELS: Record<DocLanguage, { title: string; profil: string; experience: string; education: string; skills: string; languages: string; contact: string }> = {
  de: { title: 'Lebenslauf', profil: 'Profil', experience: 'Berufserfahrung', education: 'Ausbildung', skills: 'Kenntnisse', languages: 'Sprachen', contact: 'Kontakt' },
  en: { title: 'Curriculum Vitae', profil: 'Profile', experience: 'Work experience', education: 'Education', skills: 'Skills', languages: 'Languages', contact: 'Contact' },
};
const SKILL_LEVEL: Record<DocLanguage, Record<Exclude<SkillLevel, ''>, string>> = {
  de: { basic: 'Grundkenntnisse', good: 'Gute Kenntnisse', expert: 'Sehr gute Kenntnisse' },
  en: { basic: 'Basic', good: 'Good', expert: 'Expert' },
};
const NATIVE: Record<DocLanguage, string> = { de: 'Muttersprache', en: 'Native' };

// Two columns (spec, decision 9). HTML order: name/contacts → main → sidebar, so text extraction (ATS) reads it in a
// sensible order; the grid places head + sidebar on the left.
const CSS = `.cv{width:210mm;min-height:297mm;display:grid;grid-template-columns:72mm 1fr;grid-template-rows:auto 1fr;grid-template-areas:"head main" "side main";background:linear-gradient(to right,#2f5d62 0,#2f5d62 72mm,#fff 72mm);font-size:10pt;line-height:1.4}
.head{grid-area:head;color:#fff;padding:14mm 8mm 4mm}
.head h1{font-size:20pt;margin:0 0 4mm;line-height:1.15}
.head .contact div{margin-bottom:1mm;word-break:break-word}
.side{grid-area:side;color:#fff;padding:2mm 8mm 12mm}
.side h2,.head h2{font-size:10pt;text-transform:uppercase;letter-spacing:.08em;border-bottom:1px solid rgba(255,255,255,.5);padding-bottom:1mm;margin:5mm 0 2mm}
.side .row{display:flex;justify-content:space-between;gap:3mm;margin-bottom:1mm}
.side .row span:last-child{opacity:.85;text-align:right}
.photo{display:block;width:38mm;height:38mm;object-fit:cover;border-radius:50%;margin:0 auto 5mm;border:2px solid #fff}
.main{grid-area:main;padding:14mm 14mm 12mm 10mm}
.main h2{font-size:12pt;color:#2f5d62;text-transform:uppercase;letter-spacing:.06em;border-bottom:2px solid #2f5d62;padding-bottom:1mm;margin:0 0 3mm}
.main section{margin-bottom:6mm}
.entry{display:grid;grid-template-columns:30mm 1fr;gap:3mm;margin-bottom:3mm;break-inside:avoid}
.entry .when{color:#555}
.entry .what strong{display:block}
.entry .what .where{color:#555}
.entry .what p{margin:1mm 0 0}`;

export function cvHtml(p: ApplicationPackage, photo: { data: Buffer; ext: '.jpg' | '.png' } | null): string {
  const lang = p.language;
  const t = LABELS[lang];
  const s = p.snapshot;
  const personal = s.personal;
  const desc = (id: string, fallback: string) => (p.cv.descriptions[id] ?? fallback).trim();
  const place = (city: string, country: string) => [city, country].map((x) => x.trim()).filter(Boolean).join(', ');

  const contact = [
    [personal.street, [personal.postalCode, personal.city].filter(Boolean).join(' ')].map((x) => x.trim()).filter(Boolean).join(', '),
    personal.phone, personal.email,
  ].map((x) => x.trim()).filter(Boolean);

  const entry = (id: string, from: string, to: string, title: string, org: string, city: string, country: string, text: string) => {
    const d = desc(id, text);
    return `<div class="entry"><div class="when">${e(dateRange(from, to, lang))}</div><div class="what"><strong>${e(title)}</strong><span class="where">${e([org, place(city, country)].filter(Boolean).join(' · '))}</span>${d ? `<p>${e(d)}</p>` : ''}</div></div>`;
  };
  const experience = s.experience.map((x) => entry(x.id, x.from, x.to, x.jobTitle, x.employer, x.city, x.country, x.description)).join('');
  const education = s.education.map((x) => entry(x.id, x.from, x.to, x.degree, x.institution, x.city, x.country, x.description)).join('');

  const byId = new Map(s.skills.map((k) => [k.id, k]));
  const order = p.cv.skillGroups.flatMap((g) => g.skillIds);
  const ordered = [...order.map((id) => byId.get(id)).filter((k) => k !== undefined), ...s.skills.filter((k) => !order.includes(k.id))];
  const skills = ordered.map((k) => `<div class="row"><span>${e(k.name)}</span><span>${k.level ? e(SKILL_LEVEL[lang][k.level]) : ''}</span></div>`).join('');
  const level = (l: LanguageLevel, cert: string) => [l === 'native' ? NATIVE[lang] : l, cert.trim()].filter(Boolean).join(', ');
  const languages = s.languages.map((l) => `<div class="row"><span>${e(l.language)}</span><span>${e(level(l.level, l.certificate))}</span></div>`).join('');

  const img = photo ? `<img class="photo" alt="" src="data:image/${photo.ext === '.png' ? 'png' : 'jpeg'};base64,${photo.data.toString('base64')}">` : '';
  const body = `<div class="cv">
<header class="head"><h1>${e(personal.fullName)}</h1><div class="contact">${contact.map((c) => `<div>${e(c)}</div>`).join('')}</div></header>
<main class="main">
${p.cv.profil.trim() ? `<section><h2>${t.profil}</h2><p>${e(p.cv.profil)}</p></section>` : ''}
${experience ? `<section><h2>${t.experience}</h2>${experience}</section>` : ''}
${education ? `<section><h2>${t.education}</h2>${education}</section>` : ''}
</main>
<aside class="side">${img}${skills ? `<h2>${t.skills}</h2>${skills}` : ''}${languages ? `<h2>${t.languages}</h2>${languages}` : ''}</aside>
</div>`;
  return page(lang, `${t.title} ${personal.fullName}`, CSS, body);
}
