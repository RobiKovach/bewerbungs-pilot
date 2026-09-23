import type { Language } from '../data/settings.js';
import type { LlmTask } from '../llm/types.js';

export function helloTask(language: Language): LlmTask {
  return {
    prompt: 'Greet the user of the BewerbungsPilot job-application app in one short, friendly sentence.',
    schema: {
      type: 'object',
      properties: { greeting: { type: 'string', minLength: 1, maxLength: 300 } },
      required: ['greeting'],
      additionalProperties: false,
    },
    replyLanguage: language,
  };
}
