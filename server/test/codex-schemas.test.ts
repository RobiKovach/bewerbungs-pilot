import { describe, it, expect } from 'vitest';
import type { PackageVacancy } from '@bp/shared';
import { strictProblems } from '../src/llm/codex-cli.js';
import type { LlmTask } from '../src/llm/types.js';
import { packageContext } from '../src/applications/tasks/context.js';
import { createPackageTask } from '../src/applications/tasks/create-package.js';
import { offerReplyTask } from '../src/applications/tasks/offer-reply.js';
import { refreshCvTask } from '../src/applications/tasks/refresh-cv.js';
import { reviseLetterTask } from '../src/applications/tasks/revise-letter.js';
import { emptyProfile } from '../src/profile/schema.js';
import { extractCvTask } from '../src/profile/tasks/extract-cv.js';
import { followUpTask } from '../src/profile/tasks/follow-up.js';
import { structureStoriesTask } from '../src/profile/tasks/structure-stories.js';
import { helloTask } from '../src/prompts/hello.js';
import { extractManualTask } from '../src/vacancies/tasks/extract-manual.js';
import { scoreTask } from '../src/vacancies/tasks/score.js';
import { pkg, readyPackageProfile } from './helpers/applications.js';

const VAC: PackageVacancy = { id: 'v1', title: 'Webentwickler (m/w/d)', company: 'Muster GmbH', locations: ['Hamburg'], remote: 'partial', contact: null, url: '' };
const ctx = () => packageContext(readyPackageProfile(), 'de', false);

// Every AI task the app has. Codex's --output-schema uses OpenAI strict structured outputs.
const TASKS: Record<string, () => LlmTask> = {
  hello: () => helloTask('en'),
  'extract-cv (text)': () => extractCvTask({ kind: 'text', text: 'Max Mustermann' }, 'de'),
  'extract-cv (file)': () => extractCvTask({ kind: 'file', path: 'C:\\cv.pdf' }, 'de'),
  'follow-up': () => followUpTask(emptyProfile(), 'en'),
  'structure-stories': () => structureStoriesTask([{ question: 'Proud of?', answer: 'Website' }], ['Kunde X'], 'en'),
  score: () => scoreTask([{ id: 'a', title: 'Dev', company: 'X', locations: ['Dresden'], remote: 'partial', employment: ['fulltime'], salaryText: '', text: 'React' }], emptyProfile(), 'en'),
  'manual vacancy': () => extractManualTask('Frontend Developer bei Muster GmbH. '.repeat(10), emptyProfile(), 'de'),
  'create package': () => createPackageTask(ctx(), VAC, 'Text'),
  'revise letter': () => reviseLetterTask(ctx(), VAC, 'Text', pkg().letter, 'kürzer'),
  'refresh CV': () => refreshCvTask(ctx(), VAC, 'Text'),
  'offer reply': () => offerReplyTask(ctx(), pkg({ status: 'offer' }), '48.000 €', '55.000 €'),
};

describe('strictProblems', () => {
  it('finds objects without additionalProperties: false and properties missing from required, in properties/items/anyOf', () => {
    expect(strictProblems({
      type: 'object', additionalProperties: false, required: ['a'],
      properties: {
        a: { type: 'array', items: { type: 'object', properties: { x: { type: 'string' } }, required: [] } },
        b: { anyOf: [{ type: 'object', additionalProperties: false, required: [], properties: {} }, { type: 'null' }] },
      },
    })).toEqual([
      '$: "b" is not in required',
      '$.a[]: additionalProperties is not false',
      '$.a[]: "x" is not in required',
    ]);
  });
  it('a strict schema has no problems', () => {
    expect(strictProblems(helloTask('en').schema)).toEqual([]);
  });
});

describe('every AI task schema is valid for OpenAI strict structured outputs', () => {
  for (const [name, build] of Object.entries(TASKS)) {
    it(name, () => {
      expect(strictProblems(build().schema)).toEqual([]);
    });
  }
});
