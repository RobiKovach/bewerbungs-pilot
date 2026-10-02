import { FakeProvider } from '../../src/llm/fake.js';
import type { LlmTask } from '../../src/llm/types.js';
import type { ExtractedCv } from '../../src/profile/tasks/extract-cv.js';

// A fictional person — never real data in this repo.
export const SAMPLE_CV: ExtractedCv = {
  readable: true,
  personal: {
    fullName: 'Max Mustermann', email: 'max@example.com', phone: '+49 30 1234567', street: 'Musterstraße 1',
    postalCode: '10115', city: 'Berlin', country: 'Deutschland', birthDate: '15.03.1990', nationality: '',
    workPermit: '', drivingLicense: 'B', links: [],
  },
  education: [{
    kind: 'vocational', degree: 'Fachinformatiker für Anwendungsentwicklung', institution: 'OSZ IMT Berlin', city: 'Berlin',
    country: 'Deutschland', from: '2015-09', to: '2018-06', description: 'Ausbildung mit Schwerpunkt Webentwicklung.',
  }],
  experience: [{
    jobTitle: 'Webentwickler', employer: 'Beispiel GmbH', city: 'Berlin', country: 'Deutschland', from: '07/2018', to: '',
    description: 'Entwicklung von Kundenwebseiten.',
  }],
  skills: [{ name: 'JavaScript', level: 'good' }, { name: 'WordPress', level: '' }],
  languages: [{ language: 'Deutsch', level: 'native', certificate: '' }, { language: 'Englisch', level: 'B2', certificate: '' }],
};

type Answer = unknown | ((task: LlmTask, signal: AbortSignal) => unknown);

/** Answers each profile task by the shape of its output schema, so one fake serves a whole flow. */
export function scriptedClaude(script: { cv?: Answer; questions?: Answer; stories?: Answer }): FakeProvider {
  return new FakeProvider({ ok: true }, (task, signal) => {
    const required = (task.schema as { required?: string[] }).required ?? [];
    const answer = required.includes('readable') ? script.cv : required.includes('questions') ? script.questions : script.stories;
    if (answer === undefined) throw new Error(`unexpected task: ${required.join(',')}`);
    return typeof answer === 'function' ? (answer as (t: LlmTask, s: AbortSignal) => unknown)(task, signal) : answer;
  });
}
