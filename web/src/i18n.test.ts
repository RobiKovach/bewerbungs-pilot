import { describe, it, expect } from 'vitest';
import { detectLanguage } from './i18n';

describe('detectLanguage', () => {
  it.each([
    [['de-AT', 'en'], 'de'],
    [['fr-FR'], 'en'],
    [['uk'], 'uk'],
    [['RU-ru'], 'ru'],
    [['pt-BR', 'pl-PL'], 'pl'],
    [['ro-RO'], 'ro'],
    [[], 'en'],
  ])('%j -> %s', (input, expected) => {
    expect(detectLanguage(input)).toBe(expected);
  });
});
