import crypto from 'node:crypto';
import multipart from '@fastify/multipart';
import type { FastifyInstance } from 'fastify';
import type { Language, Story, StoryInput } from '@bp/shared';
import { AppError } from '../errors.js';
import type { LlmQueue } from '../llm/queue.js';
import type { Logger } from '../log.js';
import { registerFileRoutes } from './file-routes.js';
import { FILE_RULES, type ProfileFiles } from './files.js';
import { isSectionId, LIMITS, STORY_KINDS, validateSectionData } from './schema.js';
import { applyHumanEdit, confirmSection } from './sections.js';
import type { ProfileStore } from './store.js';
import { toView, withSection } from './view.js';

export interface ProfileRouteDeps {
  store: ProfileStore;
  files: ProfileFiles;
  queue: LlmQueue;
  /** Language of free text Claude writes: the person's UI language. */
  language: () => Language;
  logger: Logger;
}

const storyFields = {
  title: { type: 'string', minLength: 1, maxLength: LIMITS.name },
  text: { type: 'string', minLength: 1, maxLength: LIMITS.text },
  kind: { enum: [...STORY_KINDS] },
  disclosure: { enum: ['ok', 'never'] },
};
const newStoryBody = { type: 'object', additionalProperties: false, required: ['title', 'text', 'kind', 'disclosure'], properties: storyFields };
const storyBody = {
  type: 'object', additionalProperties: false, required: ['title', 'text', 'kind', 'disclosure', 'confirmed'],
  properties: { ...storyFields, confirmed: { type: 'boolean' } },
};
const sectionBody = { type: 'object', additionalProperties: false, required: ['data'], properties: { data: {} } };
const wizardBody = {
  type: 'object', additionalProperties: false, required: ['step'],
  properties: { step: { enum: [1, 2, 3, 4] }, completed: { type: 'boolean' } },
};
const neverMentionBody = { type: 'array', maxItems: LIMITS.neverMention, items: { type: 'string', maxLength: LIMITS.name } };

const trimStory = (s: StoryInput): StoryInput => ({ title: s.title.trim(), text: s.text.trim(), kind: s.kind, disclosure: s.disclosure });

function sectionParam(params: unknown) {
  const { id } = params as { id: string };
  if (!isSectionId(id)) throw new AppError('NOT_FOUND', `section ${id}`);
  return id;
}

export async function registerProfileRoutes(app: FastifyInstance, d: ProfileRouteDeps): Promise<void> {
  // One file per request; per-kind size limits are set in receiveUpload. defCharset keeps names like
  // "Резюме.pdf" intact (the installed @fastify/multipart's BusboyConfig has no defParamCharset option;
  // defCharset already defaults to 'utf8', named here to keep the intent explicit).
  await app.register(multipart, {
    defCharset: 'utf8',
    limits: { fileSize: FILE_RULES.cv.maxBytes, files: 1, fields: 0, parts: 1 },
  });

  app.get('/api/profile', async () => toView(d.store.get()));

  app.put('/api/profile/wizard', { schema: { body: wizardBody } }, async (req) => {
    const { step, completed } = req.body as { step: 1 | 2 | 3 | 4; completed?: boolean };
    return toView(d.store.update((p) => {
      p.wizard.step = step;
      if (completed && p.wizard.completedAt === null) p.wizard.completedAt = new Date().toISOString();
    }));
  });

  app.put('/api/profile/sections/:id', { schema: { body: sectionBody } }, async (req) => {
    const id = sectionParam(req.params);
    const { data } = req.body as { data: unknown };
    const problem = validateSectionData(id, data);
    if (problem) throw new AppError('BAD_REQUEST', `${id}: ${problem}`);
    return toView(d.store.update((p) => withSection(p, id, (s) => applyHumanEdit(s, data))));
  });

  app.post('/api/profile/sections/:id/confirm', async (req) => {
    const id = sectionParam(req.params);
    const at = new Date().toISOString();
    return toView(d.store.update((p) => withSection(p, id, (s) => confirmSection(s, at))));
  });

  app.post('/api/profile/stories', { schema: { body: newStoryBody } }, async (req) => {
    const input = trimStory(req.body as StoryInput);
    return toView(d.store.update((p) => {
      if (p.stories.length >= LIMITS.stories) throw new AppError('BAD_REQUEST', 'too many stories');
      // Written by the person themselves, so nothing to check.
      p.stories.push({ id: crypto.randomUUID(), ...input, confirmed: true });
    }));
  });

  app.put('/api/profile/stories/:id', { schema: { body: storyBody } }, async (req) => {
    const { id } = req.params as { id: string };
    const body = req.body as Omit<Story, 'id'>;
    return toView(d.store.update((p) => {
      const i = p.stories.findIndex((s) => s.id === id);
      if (i === -1) throw new AppError('NOT_FOUND', `story ${id}`);
      p.stories[i] = { id, ...trimStory(body), confirmed: body.confirmed };
    }));
  });

  app.delete('/api/profile/stories/:id', async (req) => {
    const { id } = req.params as { id: string };
    return toView(d.store.update((p) => {
      if (!p.stories.some((s) => s.id === id)) throw new AppError('NOT_FOUND', `story ${id}`);
      p.stories = p.stories.filter((s) => s.id !== id);
    }));
  });

  app.put('/api/profile/never-mention', { schema: { body: neverMentionBody } }, async (req) => {
    const items = [...new Set((req.body as string[]).map((s) => s.trim()).filter(Boolean))];
    return toView(d.store.update((p) => { p.neverMention = items; }));
  });

  await registerFileRoutes(app, d);
}
