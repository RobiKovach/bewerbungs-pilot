// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { COOKIE_SCRIPT, READ_FRAME_SCRIPT, SCROLL_SCRIPT } from '../src/vacancies/sources/aa-contact-window.js';

/** The in-page scripts run as written in a real page; here jsdom stands in for it. */
interface Dom {
  body: { innerHTML: string; querySelector(s: string): Element | null };
  createElement(tag: string): HTMLLikeElement;
}
interface Element { addEventListener(type: string, fn: () => void): void; scrollIntoView?: () => void }
interface HTMLLikeElement extends Element { attachShadow(o: { mode: 'open' }): { innerHTML: string; querySelector(s: string): Element | null }; appendChild(e: unknown): void }

const doc = () => (globalThis as unknown as { document: Dom }).document;
const runInPage = (script: string): unknown => new Function(`return ${script}`)();

beforeEach(() => {
  doc().body.innerHTML = '';
  // jsdom has no layout: scrolling is a no-op that records the call.
  (globalThis as unknown as { Element: { prototype: { scrollIntoView: () => void } } }).Element.prototype.scrollIntoView = function scrolled(this: { dataset: Record<string, string> }) { this.dataset.scrolled = 'yes'; };
});

describe('COOKIE_SCRIPT', () => {
  it('clicks "Auswahl bestätigen", never "Alle akzeptieren"', () => {
    doc().body.innerHTML = '<div><button id="all">Alle akzeptieren</button><button id="sel">Auswahl bestätigen</button></div>';
    const clicked: string[] = [];
    for (const id of ['all', 'sel']) doc().body.querySelector(`#${id}`)!.addEventListener('click', () => clicked.push(id));
    expect(runInPage(COOKIE_SCRIPT)).toBe('Auswahl bestätigen');
    expect(clicked).toEqual(['sel']);
  });

  it('with only an accept button it clicks nothing (the person decides)', () => {
    doc().body.innerHTML = '<button id="all">Alle akzeptieren</button>';
    let clicked = false;
    doc().body.querySelector('#all')!.addEventListener('click', () => { clicked = true; });
    expect(runInPage(COOKIE_SCRIPT)).toBeNull();
    expect(clicked).toBe(false);
  });

  it('never touches a button inside the captcha', () => {
    doc().body.innerHTML = '<div class="frc-captcha"><button id="c">Ablehnen</button></div>';
    let clicked = false;
    doc().body.querySelector('#c')!.addEventListener('click', () => { clicked = true; });
    expect(runInPage(COOKIE_SCRIPT)).toBeNull();
    expect(clicked).toBe(false);
  });

  it('finds the button inside an open shadow root (the AA banner is a web component)', () => {
    const host = doc().createElement('bahf-cookie-disclaimer');
    doc().body.innerHTML = '';
    (doc().body as unknown as { appendChild(e: unknown): void }).appendChild(host);
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<button id="n">Nur notwendige Cookies</button>';
    let clicked = false;
    root.querySelector('#n')!.addEventListener('click', () => { clicked = true; });
    expect(runInPage(COOKIE_SCRIPT)).toBe('Nur notwendige Cookies');
    expect(clicked).toBe(true);
  });
});

describe('SCROLL_SCRIPT', () => {
  it('scrolls to "Informationen zur Bewerbung"', () => {
    doc().body.innerHTML = '<h2>Stellenbeschreibung</h2><h3 id="b">Informationen zur Bewerbung</h3>';
    expect(runInPage(SCROLL_SCRIPT)).toBe(true);
    expect((doc().body.querySelector('#b') as unknown as { dataset: Record<string, string> }).dataset.scrolled).toBe('yes');
  });

  it('nothing to scroll to → false', () => {
    doc().body.innerHTML = '<p>leer</p>';
    expect(runInPage(SCROLL_SCRIPT)).toBe(false);
  });
});

describe('READ_FRAME_SCRIPT', () => {
  it('reads the text, mailto:/tel: links and http links with the heading before them', () => {
    doc().body.innerHTML = [
      '<h2>Webseiten</h2><a href="https://www.beispiel.example/">Homepage</a>',
      '<h3>Informationen zur Bewerbung</h3><p>Kontaktadresse</p>',
      '<a href="mailto:jobs@beispiel.example">jobs@beispiel.example</a><a href="tel:+493511234567">Anrufen</a>',
      '<a href="https://karriere.beispiel.example/42">Über Internetseite des Arbeitgebers</a>',
    ].join('');
    const r = runInPage(READ_FRAME_SCRIPT) as { text: string; hrefs: string[]; links: Array<{ href: string; section: string }> };
    expect(r.text).toContain('Kontaktadresse');
    expect(r.hrefs).toEqual(['mailto:jobs@beispiel.example', 'tel:+493511234567']);
    expect(r.links).toEqual([
      { href: 'https://www.beispiel.example/', section: 'Webseiten' },
      { href: 'https://karriere.beispiel.example/42', section: 'Informationen zur Bewerbung' },
    ]);
  });
});
