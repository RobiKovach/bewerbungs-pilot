import { describe, it, expect } from 'vitest';
import en from './locales/en.json';
import uk from './locales/uk.json';
import de from './locales/de.json';
import ru from './locales/ru.json';
import pl from './locales/pl.json';
import ro from './locales/ro.json';
import { detectLanguage, initI18n, setAiProvider } from './i18n';

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

function flatten(o: Record<string, unknown>, prefix = ''): [string, string][] {
  return Object.entries(o).flatMap(([k, v]) => (typeof v === 'string' ? [[prefix + k, v] as [string, string]] : flatten(v as Record<string, unknown>, `${prefix}${k}.`)));
}
// Provider names appear only in the per-provider card texts; everything else says {{ai}} (spec §7).
const EXEMPT = /^onboarding\.ai\.(claude|chatgpt)\./;

describe('provider names in texts', () => {
  it.each([['en', en], ['uk', uk], ['de', de], ['ru', ru], ['pl', pl], ['ro', ro]])('%s never names an AI outside onboarding.ai.<provider>.*', (_l, dict) => {
    const offenders = flatten(dict as Record<string, unknown>).filter(([k, v]) => !EXEMPT.test(k) && /\b(Claude|ChatGPT|Codex)\b/.test(v)).map(([k]) => k);
    expect(offenders).toEqual([]);
  });

  it('{{ai}} follows the chosen provider and falls back to "AI helper"', () => {
    const i18n = initI18n('en');
    setAiProvider('chatgpt');
    expect(i18n.t('onboarding.ai.ready')).toContain('ChatGPT');
    setAiProvider('claude');
    expect(i18n.t('errors.LLM_TIMEOUT.message')).toContain('Claude');
    setAiProvider(null);
    expect(i18n.t('onboarding.ai.ready')).toContain(i18n.t('common.aiHelper'));
    void i18n.changeLanguage('uk');
    expect(i18n.t('onboarding.ai.ready')).toContain(i18n.t('common.aiHelper'));
    expect(i18n.t('common.aiHelper')).not.toBe('AI helper');
    void i18n.changeLanguage('en');
  });

  it('an explicit {{ai}} value still wins over the default', () => {
    const i18n = initI18n('en');
    setAiProvider('claude');
    expect(i18n.t('onboarding.ai.ready', { ai: 'ChatGPT' })).toContain('ChatGPT');
  });
});
