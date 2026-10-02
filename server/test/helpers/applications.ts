import { FakeProvider } from '../../src/llm/fake.js';
import type { LlmTask } from '../../src/llm/types.js';
import { AppError } from '../../src/errors.js';
import type { CreateOutput, CvOutput, LetterOutput } from '../../src/applications/tasks/context.js';
import type { ApplicationPackage, Profile } from '@bp/shared';
import { profileFingerprint, takeSnapshot } from '../../src/applications/snapshot.js';
import { emptyProfile } from '../../src/profile/schema.js';

const NOW = '2026-09-29T10:00:00.000Z';

/** Max Mustermann with everything a package needs: five confirmed sections and one tellable story. */
export function readyPackageProfile(change: (p: Profile) => void = () => {}): Profile {
  const p = emptyProfile();
  p.sections.personal.data = {
    ...p.sections.personal.data, fullName: 'Max Mustermann', email: 'max@example.com', phone: '+49 30 1234567',
    street: 'Musterstraße 1', postalCode: '10115', city: 'Berlin', country: 'Deutschland',
  };
  p.sections.education.data.items = [{ id: 'ed1', kind: 'vocational', degree: 'Fachinformatiker für Anwendungsentwicklung', institution: 'OSZ IMT Berlin', city: 'Berlin', country: 'Deutschland', from: '2015-09', to: '2018-06', description: 'Ausbildung mit Schwerpunkt Web.' }];
  p.sections.experience.data.items = [{ id: 'ex1', jobTitle: 'Webentwickler', employer: 'Beispiel GmbH', city: 'Berlin', country: 'Deutschland', from: '2018-07', to: '', description: 'Kundenwebseiten entwickelt.' }];
  p.sections.skills.data.items = [
    { id: 'sk1', name: 'JavaScript', level: 'good' }, { id: 'sk2', name: 'WordPress', level: '' },
    { id: 'sk3', name: 'CSS', level: 'expert' }, { id: 'sk4', name: 'PHP', level: 'basic' }, { id: 'sk5', name: 'Git', level: '' },
  ];
  p.sections.languages.data.items = [{ id: 'la1', language: 'Deutsch', level: 'native', certificate: '' }, { id: 'la2', language: 'Englisch', level: 'B2', certificate: '' }];
  for (const id of ['personal', 'education', 'experience', 'skills', 'languages'] as const) p.sections[id].confirmedAt = NOW;
  p.stories = [
    { id: 'st1', title: 'Online-Shop', text: 'Für einen Bäcker einen Online-Shop gebaut, Bestellungen stiegen.', kind: 'client', disclosure: 'ok', confirmed: true },
    { id: 'st2', title: 'Geheim', text: 'Projekt für Kunde X unter NDA.', kind: 'client', disclosure: 'never', confirmed: true },
  ];
  p.neverMention = ['Kunde X'];
  change(p);
  return p;
}

let n = 0;
/** A valid package for Max Mustermann; every call gets a new id unless one is given. */
export function pkg(over: Partial<ApplicationPackage> = {}, profile: Profile = readyPackageProfile()): ApplicationPackage {
  n++;
  return {
    schemaVersion: 1, id: `a${n}`, vacancyId: `v${n}`, language: 'de', status: 'draft', createdAt: NOW, updatedAt: NOW, approvedAt: null,
    profileFingerprint: profileFingerprint(profile), snapshot: takeSnapshot(profile),
    vacancy: { id: `v${n}`, title: 'Webentwickler (m/w/d)', company: 'Muster GmbH', locations: ['Berlin'], remote: 'partial', contact: null, url: '' },
    letter: {
      recipient: ['Muster GmbH', 'Berlin'], subject: 'Bewerbung als Webentwickler (m/w/d)', salutation: 'Sehr geehrte Damen und Herren,',
      paragraphs: ['Absatz eins.', 'Absatz zwei.', 'Absatz drei.'], closing: 'Mit freundlichen Grüßen', signature: 'Max Mustermann',
      storyIds: ['st1'], hint: null, pages: 1,
    },
    cv: { profil: 'Webentwickler mit sechs Jahren Erfahrung.', profilEditedByHand: false, descriptions: { ed1: 'Ausbildung mit Schwerpunkt Web.', ex1: 'Kundenwebseiten entwickelt.' }, skillOrder: ['sk1', 'sk2', 'sk3', 'sk4', 'sk5'] },
    attachments: [],
    ...over,
  };
}

export const GOOD_LETTER: LetterOutput = {
  subject: 'Bewerbung als Webentwickler (m/w/d)',
  paragraphs: [
    'Ihre Stelle als Webentwickler bei der Muster GmbH spricht mich an, weil Sie Online-Shops für den Handel bauen.',
    'Sie suchen jemanden, der Shops für kleine Händler umsetzt. Für einen Bäcker habe ich einen Online-Shop gebaut, danach stiegen seine Bestellungen deutlich.',
    'Gern zeige ich Ihnen in einem persönlichen Gespräch, wie ich Ihr Team unterstützen kann.',
  ],
  storyIds: ['st1'],
  hint: null,
};
export const GOOD_CV: CvOutput = {
  profil: 'Webentwickler mit mehrjähriger Erfahrung in Kundenwebseiten.',
  descriptions: [{ id: 'ed1', text: 'Ausbildung mit Schwerpunkt Web.' }, { id: 'ex1', text: 'Kundenwebseiten entwickelt.' }],
  skillOrder: ['sk2', 'sk1', 'sk3', 'sk4', 'sk5'],
};

type Answer<T> = T | ((task: LlmTask, signal: AbortSignal) => T | Promise<T>);
const resolve = async <T>(a: Answer<T>, task: LlmTask, signal: AbortSignal) =>
  (typeof a === 'function' ? (a as (t: LlmTask, s: AbortSignal) => T | Promise<T>)(task, signal) : a);

/** Answers create / revise / refresh-cv tasks by the shape of their output schema. */
export function packageClaude(opts: {
  create?: Answer<CreateOutput>; revise?: Answer<LetterOutput>; refresh?: Answer<CvOutput>;
  before?: (task: LlmTask, signal: AbortSignal) => unknown;
} = {}): FakeProvider {
  return new FakeProvider({ ok: true }, async (task, signal) => {
    await opts.before?.(task, signal);
    if (signal.aborted) throw new AppError('LLM_CANCELLED', 'cancelled', 'cancelledByUser');
    const required = (task.schema as { required?: string[] }).required ?? [];
    if (required.includes('paragraphs') && required.includes('profil')) return resolve(opts.create ?? { ...GOOD_LETTER, ...GOOD_CV }, task, signal);
    if (required.includes('paragraphs')) return resolve(opts.revise ?? GOOD_LETTER, task, signal);
    if (required.includes('profil')) return resolve(opts.refresh ?? GOOD_CV, task, signal);
    throw new Error(`unexpected task: ${required.join(',')}`);
  });
}
