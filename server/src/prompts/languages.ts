import type { Language } from '../data/settings.js';
import type { LlmTask } from '../llm/types.js';

export const LANGUAGE_NAMES: Record<Language, string> = {
  uk: 'Ukrainian',
  en: 'English',
  de: 'German',
  ru: 'Russian',
  pl: 'Polish',
  ro: 'Romanian',
};

export function composePrompt(task: LlmTask): string {
  return `${task.prompt}\n\nWrite all natural-language text in your answer in ${LANGUAGE_NAMES[task.replyLanguage]}.`;
}
