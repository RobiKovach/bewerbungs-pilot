import type { ApplicationPackage } from '@bp/shared';
import { escapeHtml as e, formatDate, page } from './html.js';

// DIN 5008 form B: 25 mm left / 20 mm right margin, address field from 45 mm, date right-aligned above the subject.
const CSS = `.letter{width:210mm;min-height:297mm;padding:27mm 20mm 20mm 25mm;font-size:11pt;line-height:1.4}
.sender{text-align:right;font-size:10pt;line-height:1.35;margin-bottom:10mm}
.recipient{white-space:pre-line}
.place-date{text-align:right;margin:8mm 0 8mm}
.subject{font-weight:bold;margin:0 0 8mm}
.salutation{margin:0 0 4mm}
.letter p.par{margin:0 0 3.5mm;text-align:left}
.closing{margin:6mm 0 0}
.signature{margin:0}`;

export function letterHtml(p: ApplicationPackage, now: Date): string {
  const s = p.snapshot.personal;
  const L = p.letter;
  const city = s.city.trim();
  const sender = [s.fullName, s.street, [s.postalCode, s.city].filter(Boolean).join(' '), s.phone, s.email].map((x) => x.trim()).filter(Boolean);
  const body = `<div class="letter">
<div class="sender">${sender.map(e).join('<br>')}</div>
<div class="recipient">${L.recipient.map(e).join('<br>')}</div>
<div class="place-date">${e([city, formatDate(now, p.language)].filter(Boolean).join(', '))}</div>
<p class="subject">${e(L.subject)}</p>
<p class="salutation">${e(L.salutation)}</p>
${L.paragraphs.map((par) => `<p class="par">${e(par)}</p>`).join('\n')}
<p class="closing">${e(L.closing)}</p>
<p class="signature">${e(L.signature)}</p>
</div>`;
  return page(p.language, p.language === 'en' ? 'Cover letter' : 'Anschreiben', CSS, body);
}
