import { describe, it, expect } from 'vitest';
import { cvHtml } from '../src/applications/render/cv.js';
import { asciiName, dateRange, escapeHtml, fileNames, formatDate } from '../src/applications/render/html.js';
import { letterHtml } from '../src/applications/render/letter.js';
import { pkg, readyPackageProfile } from './helpers/applications.js';

const NOW = new Date('2026-09-29T10:00:00.000Z');

describe('html helpers', () => {
  it('escapes the five HTML characters', () => {
    expect(escapeHtml(`<script>"a" & 'b'</script>`)).toBe('&lt;script&gt;&quot;a&quot; &amp; &#39;b&#39;&lt;/script&gt;');
  });
  it('dates by language', () => {
    expect(formatDate(NOW, 'de')).toBe('29.09.2026');
    expect(formatDate(NOW, 'en')).toBe('29 September 2026');
    expect(dateRange('2018-07', '', 'de')).toBe('07/2018 – heute');
    expect(dateRange('2018-07', '', 'en')).toBe('07/2018 – present');
    expect(dateRange('2015-09', '2018-06', 'de')).toBe('09/2015 – 06/2018');
    expect(dateRange('2015', '2015', 'de')).toBe('2015');
    expect(dateRange('', '', 'de')).toBe('');
  });
  it('safe ASCII file names', () => {
    expect(asciiName('Müller & Söhne GmbH')).toBe('Mueller_Soehne_GmbH');
    expect(asciiName('Zoë Łukasz-Nowak')).toBe('Zoe_Lukasz-Nowak');
    expect(asciiName('Straße')).toBe('Strasse');
    expect(asciiName('ООО «Ромашка»')).toBe('');
    expect(fileNames('Max Mustermann', 'Muster GmbH')).toEqual({
      letter: 'Anschreiben_Max_Mustermann_Muster_GmbH.pdf', cv: 'Lebenslauf_Max_Mustermann.pdf', bundle: 'Bewerbung_Max_Mustermann_Muster_GmbH.pdf',
    });
    expect(fileNames('', 'ООО')).toEqual({ letter: 'Anschreiben.pdf', cv: 'Lebenslauf.pdf', bundle: 'Bewerbung.pdf' });
  });
});

describe('letterHtml', () => {
  it('has sender, recipient, place and date, subject, salutation, paragraphs, closing, signature — in that order', () => {
    const html = letterHtml(pkg(), NOW);
    const order = ['Max Mustermann', 'Musterstraße 1', '10115 Berlin', 'max@example.com', 'Muster GmbH', 'Berlin, 29.09.2026', 'Bewerbung als Webentwickler', 'Sehr geehrte Damen und Herren,', 'Absatz eins.', 'Absatz drei.', 'Mit freundlichen Grüßen'];
    const positions = order.map((s) => html.indexOf(s));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(html).toContain('<html lang="de">');
    expect(html).not.toMatch(/<script/i);
  });
  it('escapes every text and uses the English date in English', () => {
    const p = pkg({ language: 'en' });
    p.letter.paragraphs = ['<b>bold</b> & "quoted"', 'b', 'c'];
    const html = letterHtml(p, NOW);
    expect(html).toContain('&lt;b&gt;bold&lt;/b&gt; &amp; &quot;quoted&quot;');
    expect(html).toContain('Berlin, 29 September 2026');
    expect(html).toContain('<html lang="en">');
  });
});

describe('cvHtml', () => {
  it('reads side column (name, contacts, skills, languages) → main (Profil, experience, education) in HTML order', () => {
    const html = cvHtml(pkg(), null);
    const order = ['Max Mustermann', 'max@example.com', 'Kenntnisse', 'Sprachen', 'Muttersprache', 'Profil', 'Webentwickler mit sechs Jahren', 'Berufserfahrung', 'Beispiel GmbH', 'Ausbildung', 'OSZ IMT Berlin'];
    const positions = order.map((s) => html.indexOf(s));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(html).not.toContain('<img');
  });
  it('uses Claude\'s translated descriptions and skill order, falls back to the profile text, and labels in English', () => {
    const p = pkg({ language: 'en' });
    p.cv.descriptions = { ex1: 'Built client websites.' };
    p.cv.skillGroups = [{ name: '', skillIds: ['sk5', 'sk1'] }];
    const html = cvHtml(p, null);
    expect(html).toContain('Built client websites.');
    expect(html).toContain('Ausbildung mit Schwerpunkt Web.'); // no translation given → profile text
    expect(html.indexOf('Git')).toBeLessThan(html.indexOf('JavaScript'));
    expect(html.indexOf('JavaScript')).toBeLessThan(html.indexOf('WordPress')); // ungrouped skills follow the grouped ones, in profile order
    expect(html).toContain('PHP');
    expect(html).toContain('Work experience');
    expect(html).toContain('Native');
    expect(html).toContain('07/2018 – present');
  });
  it('embeds the photo as a data URI', () => {
    const html = cvHtml(pkg(), { data: Buffer.from([1, 2, 3]), ext: '.png' });
    expect(html).toContain('src="data:image/png;base64,AQID"');
  });
  it('escapes profile text', () => {
    const p = pkg({}, readyPackageProfile((x) => { x.sections.experience.data.items[0].employer = 'A & <B>'; }));
    expect(cvHtml(p, null)).toContain('A &amp; &lt;B&gt;');
  });
});

function pkgWith(o: { headline?: string; links?: { label: string; url: string }[]; skillGroups?: { name: string; skillIds: string[] }[]; translations?: Record<string, string>; certificate?: boolean }) {
  const profile = readyPackageProfile((x) => {
    x.sections.skills.data.items = [{ id: 's1', name: 'HTML5', level: 'good' }, { id: 's2', name: 'CSS3', level: '' }];
    x.sections.personal.data = { ...x.sections.personal.data, country: 'Україна', links: o.links ?? [] };
    x.sections.languages.data.items = [{ id: 'la1', language: 'Українська', level: 'native', certificate: '' }];
    x.sections.experience.data.items[0]!.country = 'Україна';
    if (o.certificate) x.sections.education.data.items.push({ id: 'ed2', kind: 'certificate', degree: 'Zertifikat X', institution: 'Akademie', city: 'Berlin', country: 'Deutschland', from: '2020-01', to: '2020-02', description: '' });
  });
  const p = pkg({}, profile);
  p.cv.headline = o.headline ?? '';
  p.cv.skillGroups = o.skillGroups ?? [{ name: 'Web', skillIds: ['s1', 's2'] }];
  p.cv.translations = o.translations ?? {};
  return p;
}

describe('cvHtml — layout like the example', () => {
  it('left column order: photo, name, headline, KONTAKT with labels and links, skill groups, languages', () => {
    const html = cvHtml(pkgWith({ headline: 'Webentwickler / WordPress', links: [{ label: 'GitHub', url: 'https://github.com/maxmuster' }] }), { data: Buffer.from([1]), ext: '.png' });
    const order = ['class="photo"', '<h1>Max Mustermann', 'Webentwickler / WordPress', '>Kontakt<', 'Adresse', 'Telefon', 'E-Mail', 'GitHub', 'github.com/maxmuster', '>Kenntnisse<', '>Sprachen<']
      .map((s) => html.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).not.toContain('https://github.com');
    expect(html).not.toMatch(/<a[\s>]/);
  });
  it('skills: group name in bold, names comma-separated, no levels', () => {
    const html = cvHtml(pkgWith({ skillGroups: [{ name: 'Web', skillIds: ['s1', 's2'] }] }), null);
    expect(html).toContain('<strong>Web</strong>');
    expect(html).toContain('HTML5, CSS3');
    expect(html).not.toMatch(/Grundkenntnisse|Gute Kenntnisse|Sehr gute Kenntnisse/);
  });
  it('countries and language names use the translations', () => {
    const html = cvHtml(pkgWith({ translations: { 'Україна': 'Ukraine', 'Українська': 'Ukrainisch' } }), null);
    expect(html).toContain('Ukraine');
    expect(html).toContain('Ukrainisch');
    expect(html).not.toContain('Україна');
  });
  it('courses and certificates get their own section; without them it is absent', () => {
    expect(cvHtml(pkgWith({ certificate: true }), null)).toContain('Weiterbildung &amp; Zertifikate');
    expect(cvHtml(pkgWith({}), null)).not.toContain('Weiterbildung');
  });
  it('escapes link labels and urls and the headline', () => {
    const html = cvHtml(pkgWith({ headline: '<b>x</b>', links: [{ label: '<script>', url: 'https://a.example/?q="1"&x' }] }), null);
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>x</b>');
    expect(html).toContain('&lt;script&gt;');
  });
  it('a migrated v1 package (one unnamed group, no headline) renders without a group title or headline line', () => {
    const html = cvHtml(pkgWith({ headline: '', skillGroups: [{ name: '', skillIds: ['s1', 's2'] }] }), null);
    expect(html).not.toContain('<strong></strong>');
    expect(html).not.toContain('class="headline"');
    expect(html).toContain('HTML5, CSS3');
  });
  it('a CV longer than one page: the left colour is a fixed strip (repeated on every printed page), the columns repeat their padding on page 2', () => {
    const html = cvHtml(pkgWith({}), null);
    expect(html).toMatch(/\.cv::before\{[^}]*position:fixed;top:0;bottom:0;left:0;width:74mm;background:#2f5d62/);
    expect(html).toMatch(/\.side,\.main\{[^}]*box-decoration-break:clone/);
    expect(html).not.toContain('linear-gradient');
  });
});
