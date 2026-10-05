// Manual check that PDFs print with the browser installed on this PC. Run: npm run check:pdf   (never part of npm test)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ApplicationPackage } from '@bp/shared';
import { BrowserPrinter, countPages, findBrowser } from '../src/applications/pdf.js';
import { cvHtml } from '../src/applications/render/cv.js';
import { letterHtml } from '../src/applications/render/letter.js';

const sample: ApplicationPackage = {
  schemaVersion: 2, id: 'check', vacancyId: 'check', language: 'de', status: 'draft',
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), approvedAt: null, profileFingerprint: '0'.repeat(64),
  snapshot: {
    personal: { fullName: 'Max Mustermann', email: 'max@example.com', phone: '+49 30 1234567', street: 'Musterstraße 1', postalCode: '10115', city: 'Berlin', country: 'Deutschland', birthDate: '', nationality: '', workPermit: '', drivingLicense: '', links: [] },
    education: [{ id: 'ed1', kind: 'vocational', degree: 'Fachinformatiker für Anwendungsentwicklung', institution: 'OSZ IMT Berlin', city: 'Berlin', country: 'Deutschland', from: '2015-09', to: '2018-06', description: 'Ausbildung mit Schwerpunkt Webentwicklung.' }],
    experience: [{ id: 'ex1', jobTitle: 'Webentwickler', employer: 'Beispiel GmbH', city: 'Berlin', country: 'Deutschland', from: '2018-07', to: '', description: 'Entwicklung von Kundenwebseiten mit WordPress und JavaScript.' }],
    skills: [{ id: 'sk1', name: 'JavaScript', level: 'good' }, { id: 'sk2', name: 'WordPress', level: 'expert' }, { id: 'sk3', name: 'CSS', level: 'good' }],
    languages: [{ id: 'la1', language: 'Deutsch', level: 'native', certificate: '' }, { id: 'la2', language: 'Englisch', level: 'B2', certificate: '' }],
    photo: null,
  },
  vacancy: { id: 'check', title: 'Webentwickler (m/w/d)', company: 'Muster GmbH', locations: ['Hamburg'], remote: 'partial', contact: null, url: '' },
  letter: {
    recipient: ['Muster GmbH', 'Hamburg'], subject: 'Bewerbung als Webentwickler (m/w/d)', salutation: 'Sehr geehrte Damen und Herren,',
    paragraphs: Array.from({ length: 4 }, (_, i) => `Absatz ${i + 1}: ${'Dies ist ein Beispieltext für die Prüfung des Seitenumbruchs. '.repeat(4)}`),
    closing: 'Mit freundlichen Grüßen', signature: 'Max Mustermann', storyIds: [], hint: null, pages: 0,
  },
  cv: { profil: 'Webentwickler mit mehrjähriger Erfahrung.', profilEditedByHand: false, descriptions: {}, headline: '', headlineEditedByHand: false, skillGroups: [{ name: '', skillIds: ['sk2', 'sk1', 'sk3'] }], translations: {} },
  attachments: [],
};

const browser = findBrowser();
console.log(`browser: ${browser ?? 'NOT FOUND'}`);
if (!browser) process.exit(1);
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-check-pdf-'));
const printer = new BrowserPrinter({ tmpRoot: out });
for (const [name, html] of [['letter', letterHtml(sample, new Date())], ['cv', cvHtml(sample, null)]] as const) {
  const started = Date.now();
  const pdf = await printer.print(html);
  const file = path.join(out, `${name}.pdf`);
  fs.writeFileSync(file, pdf);
  console.log(`${name.padEnd(7)} pages=${await countPages(pdf)}  ${Date.now() - started} ms  ${file}`);
}
