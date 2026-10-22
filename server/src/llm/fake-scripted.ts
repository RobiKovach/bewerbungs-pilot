import type { PackageContext } from '../applications/tasks/context.js';
import type { ExtractedCv } from '../profile/tasks/extract-cv.js';
import type { LlmTask } from './types.js';

/**
 * `--fake-llm` (end-to-end runs and demos): a believable answer for every task the app sends, so the whole app can be
 * clicked through without an AI helper. Answers are built from the task's own prompt (ids, profile, offer, amounts),
 * so they pass the app's checks. Never used with a real AI helper.
 */

/** Contents of the fenced data blocks with this label (see fenceUntrusted). */
function fenced(prompt: string, label: string): string[] {
  const tag = `UNTRUSTED_${label.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_[0-9a-f]{16}`;
  const re = new RegExp(`<<<(${tag})>>>\\n([\\s\\S]*?)\\n<<<END_\\1>>>`, 'g');
  return [...prompt.matchAll(re)].map((m) => m[2]);
}

function fencedJson<T>(prompt: string, label: string): T {
  const block = fenced(prompt, label)[0];
  if (block === undefined) throw new Error(`fake AI: no "${label}" block in the prompt`);
  return JSON.parse(block) as T;
}

type ProfileBlock = Pick<PackageContext, 'education' | 'experience' | 'skills' | 'stories' | 'jobTitles' | 'toTranslate'>;

const isGerman = (task: LlmTask) => task.replyLanguage === 'de';

/** The job title from the offer block: its first line is the offer's metadata as JSON. */
function offerTitle(prompt: string): string {
  const block = fenced(prompt, 'vacancy')[0] ?? '';
  try {
    const meta = JSON.parse(block.split('\n')[0]) as { title?: unknown };
    if (typeof meta.title === 'string' && meta.title.trim()) return meta.title.trim();
  } catch { /* fall through */ }
  return 'Webentwickler (m/w/d)';
}

function letter(task: LlmTask): { subject: string; paragraphs: string[]; storyIds: string[]; hint: null } {
  const data = fencedJson<ProfileBlock>(task.prompt, 'profile');
  const title = offerTitle(task.prompt);
  const de = isGerman(task);
  return {
    subject: de ? `Bewerbung als ${title}` : `Application for ${title}`,
    paragraphs: de
      ? [
        `Ihre Stelle als ${title} spricht mich an, weil ich gern an Projekten arbeite, die Menschen im Alltag helfen.`,
        'In einem meiner Projekte habe ich eine Aufgabe von der ersten Idee bis zur fertigen Lösung begleitet und dabei viel gelernt.',
        'Ich freue mich darauf, Sie in einem persönlichen Gespräch kennenzulernen.',
      ]
      : [
        `Your opening as ${title} appeals to me because I like working on projects that help people every day.`,
        'In one of my projects I took a task from the first idea to the finished solution and learned a lot on the way.',
        'I look forward to meeting you in person.',
      ],
    storyIds: data.stories.slice(0, 1).map((s) => s.id),
    hint: null,
  };
}

function cv(task: LlmTask) {
  const data = fencedJson<ProfileBlock>(task.prompt, 'profile');
  const de = isGerman(task);
  const headline = data.jobTitles[0] ?? data.experience[0]?.jobTitle ?? (de ? 'Bewerber' : 'Applicant');
  return {
    profil: de
      ? 'Engagierte Fachkraft mit praktischer Erfahrung, die gern im Team arbeitet und Neues schnell lernt.'
      : 'Committed professional with hands-on experience who enjoys teamwork and learns new things quickly.',
    headline: headline.slice(0, 80),
    descriptions: [...data.education, ...data.experience].filter((e) => e.description.trim()).map((e) => ({ id: e.id, text: e.description.trim() })),
    skillGroups: [{ name: de ? 'Kenntnisse' : 'Skills', skillIds: data.skills.map((k) => k.id) }],
    translations: data.toTranslate.map((from) => ({ from, to: from })),
  };
}

const FICTIONAL_CV: ExtractedCv = {
  readable: true,
  personal: {
    fullName: 'Max Mustermann', email: 'max.mustermann@example.com', phone: '+49 30 1234567', street: 'Musterstraße 1',
    postalCode: '10115', city: 'Berlin', country: 'Deutschland', nationality: '', workPermit: '', drivingLicense: '',
    birthDate: '', links: [],
  },
  education: [{ kind: 'vocational', degree: 'Fachinformatiker für Anwendungsentwicklung', institution: 'OSZ IMT Berlin', city: 'Berlin', country: 'Deutschland', from: '2015-09', to: '2018-06', description: 'Training with a focus on web development.' }],
  experience: [{ jobTitle: 'Webentwickler', employer: 'Beispiel GmbH', city: 'Berlin', country: 'Deutschland', from: '2018-07', to: '', description: 'Built and maintained websites for customers.' }],
  skills: [{ name: 'JavaScript', level: 'good' }, { name: 'CSS', level: 'expert' }, { name: 'WordPress', level: '' }],
  languages: [{ language: 'Deutsch', level: 'native', certificate: '' }, { language: 'Englisch', level: 'B2', certificate: '' }],
};

function manual(task: LlmTask) {
  const text = fenced(task.prompt, 'pasted vacancy')[0] ?? '';
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const company = lines.find((l) => /\b(GmbH|AG|KG|SE|UG|e\.\s?V\.)(\s|$)/.test(l)) ?? 'Beispiel GmbH';
  const city = /\b\d{5}\s+([\p{Lu}][\p{L}-]+)/u.exec(text)?.[1] ?? '';
  const email = /[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}/i.exec(text)?.[0] ?? '';
  return {
    isVacancy: lines.length > 0,
    title: lines[0] ?? '', company, city, remote: 'unknown', employment: ['fulltime'], salaryText: '',
    contact: { email, salutation: '', name: '' },
    score: 72, why: ['Fits the wished job title (fake AI answer).'], missing: [],
  };
}

function score(task: LlmTask) {
  const ids = [...task.prompt.matchAll(/^Offer id: (.+)$/gm)].map((m) => m[1].trim());
  const values = [86, 64, 38];
  return {
    results: ids.map((id, i) => {
      const value = values[i % values.length];
      return { id, score: value, why: ['Fits the wished job title (fake AI answer).'], missing: value < 50 ? ['Some requirements do not fit (fake AI answer).'] : [] };
    }),
  };
}

function offerReply(task: LlmTask) {
  const { wanted } = fencedJson<{ offered: string; wanted: string }>(task.prompt, 'amounts');
  const salutation = /start with the salutation "([^"]*)"/.exec(task.prompt)?.[1] ?? '';
  const name = /and the name "([^"]*)"/.exec(task.prompt)?.[1] ?? '';
  const de = isGerman(task);
  const body = de
    ? `${salutation}\n\nvielen Dank für Ihr Angebot, ich freue mich sehr darüber und bin an der Stelle weiterhin sehr interessiert. Mit Blick auf meine Erfahrung bitte ich um ein Jahresgehalt von ${wanted}.\n\nMit freundlichen Grüßen\n${name}`
    : `${salutation}\n\nthank you for your offer, I am very glad about it and still very interested in the position. In view of my experience I ask for an annual salary of ${wanted}.\n\nKind regards\n${name}`;
  return { body };
}

export function scriptedResponse(task: LlmTask): unknown {
  switch (task.id) {
    case 'probe': return { ok: true };
    case 'hello': return { greeting: 'Hello from the fake AI helper!' };
    case 'extract-cv': return FICTIONAL_CV;
    case 'follow-up': return {
      questions: [
        { question: 'Which project are you most proud of, and for whom was it?', why: 'A concrete project makes a cover letter believable.' },
        { question: 'How did you come to this profession?', why: 'Your path shows motivation.' },
        { question: 'Is there anything employers must never be told, for example a client\'s name?', why: 'So it never appears in your letters.' },
      ],
    };
    case 'structure-stories': {
      const answers = fencedJson<{ question: string; answer: string }[]>(task.prompt, 'answers');
      return {
        stories: answers.filter((a) => a.answer.trim()).map((a) => ({
          title: a.question.trim().slice(0, 60) || 'Story', text: a.answer.trim(), kind: 'work', disclosure: 'ok',
        })),
      };
    }
    case 'extract-manual': return manual(task);
    case 'score': return score(task);
    case 'create-package': return { ...letter(task), ...cv(task) };
    case 'refresh-cv': return cv(task);
    case 'revise-letter': return letter(task);
    case 'offer-reply': return offerReply(task);
    default: {
      const unknown: never = task.id;
      throw new Error(`fake AI: no scripted answer for task "${String(unknown)}"`);
    }
  }
}
