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
  it('reads name/contacts → main (Profil, experience, education) → sidebar (skills, languages) in HTML order', () => {
    const html = cvHtml(pkg(), null);
    const order = ['Max Mustermann', 'max@example.com', 'Profil', 'Webentwickler mit sechs Jahren', 'Berufserfahrung', 'Beispiel GmbH', 'Ausbildung', 'OSZ IMT Berlin', 'Kenntnisse', 'Sprachen', 'Muttersprache'];
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
    expect(html.indexOf('JavaScript')).toBeLessThan(html.indexOf('WordPress')); // skills not in skillOrder come after, in profile order
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
