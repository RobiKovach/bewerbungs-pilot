import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import type { Language, ProviderId } from './types';
import de from './locales/de.json';
import en from './locales/en.json';
import pl from './locales/pl.json';
import ro from './locales/ro.json';
import ru from './locales/ru.json';
import uk from './locales/uk.json';

export const SUPPORTED_LANGUAGES: readonly Language[] = ['uk', 'en', 'de', 'ru', 'pl', 'ro'];

// Each language named in itself, so a user can always find their own.
export const LANGUAGE_LABELS: Record<Language, string> = {
  uk: 'Українська', en: 'English', de: 'Deutsch', ru: 'Русский', pl: 'Polski', ro: 'Română',
};

export function detectLanguage(candidates: readonly string[]): Language {
  for (const c of candidates) {
    const base = c.toLowerCase().split('-')[0] as Language;
    if (SUPPORTED_LANGUAGES.includes(base)) return base;
  }
  return 'en';
}

// <html lang> follows the UI language (screen readers, spell-check, hyphenation).
function syncDocumentLang(lng: string) {
  document.documentElement.lang = lng;
}

// Provider names are never translated (spec §7).
export const AI_NAMES: Record<ProviderId, string> = { claude: 'Claude', chatgpt: 'ChatGPT' };
let aiProvider: ProviderId | null = null;

// {{ai}} in every text = the chosen AI helper (spec §7); no provider yet → the localized "AI helper".
// i18next reads defaultVariables at t() time, so updating the object is enough.
function applyAiName() {
  const interpolation = (i18n.options.interpolation ??= {});
  const vars = (interpolation.defaultVariables ??= {});
  vars.ai = aiProvider ? AI_NAMES[aiProvider] : i18n.t('common.aiHelper', { ai: '' });
}

// Components re-render on 'aiChanged' (react.bindI18n below), so visible texts switch names at once.
export function setAiProvider(id: ProviderId | null) {
  if (id === aiProvider) return;
  aiProvider = id;
  if (!i18n.isInitialized) return;
  applyAiName();
  i18n.emit('aiChanged');
}

export function initI18n(lng: Language) {
  if (i18n.isInitialized) {
    void i18n.changeLanguage(lng);
    return i18n;
  }
  void i18n.use(initReactI18next).init({
    resources: {
      en: { translation: en }, uk: { translation: uk }, de: { translation: de },
      ru: { translation: ru }, pl: { translation: pl }, ro: { translation: ro },
    },
    lng,
    fallbackLng: 'en',
    interpolation: { escapeValue: false, defaultVariables: { ai: '' } },
    initAsync: false,
    react: { bindI18n: 'languageChanged aiChanged' },
  });
  syncDocumentLang(i18n.language);
  i18n.on('languageChanged', syncDocumentLang);
  applyAiName();
  i18n.on('languageChanged', applyAiName);
  return i18n;
}
