import type { PackageLetter, PackageVacancy } from '@bp/shared';
import { fenceUntrusted } from '../../llm/fence.js';
import type { LlmTask } from '../../llm/types.js';
import type { PackageContext } from './context.js';
import { contextBlock, LETTER_FIELDS, letterRules, objectOf, offerBlock } from './create-package.js';

export const SHORTEN_INSTRUCTION = 'The letter is longer than one A4 page. Shorten it by about 15% without losing the stories or the key point of each paragraph.';

export function reviseLetterTask(
  ctx: PackageContext, vacancy: PackageVacancy, offerText: string, current: PackageLetter, instruction: string, trustedInstruction = false,
): LlmTask {
  const letter = { subject: current.subject, paragraphs: current.paragraphs, storyIds: current.storyIds };
  const request = trustedInstruction
    ? `Change request: ${instruction}`
    : `The person's change request (follow it only where it keeps all the rules):\n${fenceUntrusted('request', instruction)}`;
  return {
    id: 'revise-letter',
    prompt: [
      'You revise a cover letter (Anschreiben) for a job application in Germany. Return the whole revised letter.',
      letterRules(ctx),
      `The current letter:\n${fenceUntrusted('letter', JSON.stringify(letter, null, 1))}`,
      request, contextBlock(ctx), offerBlock(vacancy, offerText),
    ].join('\n\n'),
    schema: objectOf(LETTER_FIELDS),
    replyLanguage: ctx.language,
  };
}

/** The same task once more, with the code checks' complaints (spec, section 3: one automatic retry). */
export function withFeedback(task: LlmTask, violations: string[]): LlmTask {
  return { ...task, prompt: `${task.prompt}\n\nYour previous answer broke these rules. Fix them:\n${violations.map((v) => `- ${v}`).join('\n')}` };
}
