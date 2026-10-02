import type { PackageVacancy } from '@bp/shared';
import type { LlmTask } from '../../llm/types.js';
import type { PackageContext } from './context.js';
import { contextBlock, CV_FIELDS, cvRules, objectOf, offerBlock } from './create-package.js';

export function refreshCvTask(ctx: PackageContext, vacancy: PackageVacancy, offerText: string): LlmTask {
  return {
    prompt: [
      'You prepare the tailored parts of a CV (Lebenslauf) for one job application in Germany. The profile changed; build the parts again from it.',
      cvRules(ctx), contextBlock(ctx), offerBlock(vacancy, offerText),
    ].join('\n\n'),
    schema: objectOf(CV_FIELDS),
    replyLanguage: ctx.language,
  };
}
