import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import type { Language } from './types';
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
    interpolation: { escapeValue: false },
    initAsync: false,
  });
  return i18n;
}
