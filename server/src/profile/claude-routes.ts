import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { CvResult, CvSectionId, StoredFile, StoryAnswer } from '@bp/shared';
import { AppError } from '../errors.js';
import { abortOnClose } from '../http.js';
import { docxToText } from './docx.js';
import { removeQuietly } from './files.js';
import { countLetters, MIN_PDF_LETTERS, pdfToText } from './pdf-text.js';
import type { ProfileRouteDeps } from './routes.js';
import { CV_SECTION_IDS, LIMITS } from './schema.js';
import { applyExtraction, type ExtractionOutcome } from './sections.js';
import { extractCvTask, MIN_CV_TEXT_CHARS, toSectionData, type CvSource, type ExtractedCv } from './tasks/extract-cv.js';
import { followUpTask, toQuestions, type FollowUpOutput } from './tasks/follow-up.js';
import { structureStoriesTask, toStories, type StoriesOutput } from './tasks/structure-stories.js';
import { receiveUpload } from './upload.js';
import { setProposal, toView, withSection } from './view.js';

const newId = () => crypto.randomUUID();

const answersBody = {
  type: 'object', additionalProperties: false, required: ['answers'],
  properties: {
    answers: {
      type: 'array', maxItems: LIMITS.questions,
      items: {
        type: 'object', additionalProperties: false, required: ['questionId', 'answer'],
        properties: { questionId: { type: 'string', maxLength: 64 }, answer: { type: 'string', maxLength: LIMITS.text } },
      },
    },
  },
};

export async function registerClaudeRoutes(app: FastifyInstance, d: ProfileRouteDeps): Promise<void> {
  app.post('/api/profile/cv', async (req, reply): Promise<CvResult> => {
    const signal = abortOnClose(reply);
    const stored = await receiveUpload(req, d.files, 'cv');
    let oldCv: StoredFile | null;
    let result: CvResult;
    try {
      const file = d.files.pathOf(stored);
      let source: CvSource = { kind: 'file', path: file };
      if (stored.ext === '.docx') {
        const text = (await docxToText(file)).trim();
        if (text.length < MIN_CV_TEXT_CHARS) {
          throw new AppError('CV_UNREADABLE', `docx has only ${text.length} characters of text`, 'cvTooLittleText', { chars: text.length });
        }
        source = { kind: 'text', text };
      } else if (!d.queue.current().readsFiles) {
        // ChatGPT never gets files: the app reads the PDF itself. A scan has no letters to read.
        const text = (await pdfToText(file)).trim();
        if (countLetters(text) < MIN_PDF_LETTERS) throw new AppError('CV_NO_TEXT', `pdf has only ${countLetters(text)} letters`);
        source = { kind: 'text', text };
      }
      const out = await d.queue.run<ExtractedCv>(extractCvTask(source, d.language()), signal);
      if (!out.readable) throw new AppError('CV_UNREADABLE', 'Claude found no CV content', 'cvNoContent');
      const data = toSectionData(out, newId);
      oldCv = d.store.get().cv;
      const outcomes: Partial<Record<CvSectionId, ExtractionOutcome>> = {};
      // Applied to the profile as it is NOW, so edits made while Claude was reading are kept (and count as
      // "worked on": such a section gets a proposal instead of being replaced).
      const profile = d.store.update((p) => {
        for (const id of CV_SECTION_IDS) {
          withSection(p, id, (s) => {
            const r = applyExtraction(s, data[id]);
            outcomes[id] = r.outcome;
            setProposal(p, id, r.proposal);
            return r.section;
          });
        }
        p.cv = stored;
        if (p.wizard.step === 1) p.wizard.step = 2;
      });
      result = {
        ...toView(profile),
        changedSections: CV_SECTION_IDS.filter((id) => outcomes[id] === 'replaced'),
        proposedSections: CV_SECTION_IDS.filter((id) => outcomes[id] === 'proposed'),
      };
    } catch (err) {
      // Only failures BEFORE the profile commits get here: the new upload is not referenced yet, so it is
      // safe to delete. Once store.update() has succeeded, we fall through to the code below instead.
      d.files.remove(stored);
      throw err;
    }
    // The new CV is now the one the profile points to. Deleting the old one is a courtesy cleanup, not
    // part of the contract: it must never fail the request or delete the new (now-referenced) file.
    if (oldCv) removeQuietly(d.files, oldCv, d.logger);
    return result;
  });

  app.post('/api/profile/followups', async (_req, reply) => {
    const signal = abortOnClose(reply);
    const out = await d.queue.run<FollowUpOutput>(followUpTask(d.store.get(), d.language()), signal);
    return toView(d.store.update((p) => { p.pendingQuestions = toQuestions(out, newId); }));
  });

  app.post('/api/profile/stories/structure', { schema: { body: answersBody } }, async (req, reply) => {
    const signal = abortOnClose(reply);
    const { answers } = req.body as { answers: StoryAnswer[] };
    const before = d.store.get();
    const answered = answers.filter((a) => a.answer.trim()).map((a) => {
      const q = before.pendingQuestions.find((x) => x.id === a.questionId);
      if (!q) throw new AppError('BAD_REQUEST', `unknown question ${a.questionId}`);
      return { question: q.question, answer: a.answer.trim() };
    });
    if (answered.length === 0) throw new AppError('BAD_REQUEST', 'no answers to turn into stories');
    const out = await d.queue.run<StoriesOutput>(structureStoriesTask(answered, before.neverMention, d.language()), signal);
    return toView(d.store.update((p) => {
      const room = Math.max(0, LIMITS.stories - p.stories.length);
      p.stories.push(...toStories(out, newId).slice(0, room));
      p.pendingQuestions = [];
    }));
  });
}
