import path from 'node:path';
import type { Language, Profile, Story, Vacancy } from '@bp/shared';
import type { SettingsStore } from '../data/settings.js';
import { AppError } from '../errors.js';
import { FICTIONAL_CV } from '../llm/fake-scripted.js';
import type { SecretStore } from '../mail/secret.js';
import type { ProfileStore } from '../profile/store.js';
import { toSectionData } from '../profile/tasks/extract-cv.js';
import type { RunningInstance } from '../runtime/instance.js';
import type { VacancyStore } from '../vacancies/store.js';
import { openUrl } from '../runtime/launch-key.js';

/**
 * «Try the demo» (spec 0.10.0): a second copy of the app with scripted AI answers, mail written to files and the
 * fictional Max Mustermann, so a new person sees the whole app before installing an AI helper or connecting a
 * mailbox. It runs on its own data folder, so nothing in the demo touches the person's own profile.
 */
export const demoDataRoot = (realRoot: string) => path.join(realRoot, 'demo');

/** Only the demo launcher's `--demo` (or BP_DEMO=1) starts the demo; a normal start always opens the person's own, empty profile. */
export const isDemoStart = (argv: readonly string[], env: NodeJS.ProcessEnv) => argv.includes('--demo') || env.BP_DEMO === '1';

const HOST = '127.0.0.1';

const STORIES: Omit<Story, 'id'>[] = [
  {
    title: 'Website for a dental practice', kind: 'client', disclosure: 'ok', confirmed: true,
    text: 'Built a new website for a dental practice in Berlin from a design template: online booking, a page for every treatment and a contact form. Patients book more often online since then.',
  },
  {
    title: 'How I became a web developer', kind: 'training', disclosure: 'ok', confirmed: true,
    text: 'Trained as Fachinformatiker für Anwendungsentwicklung, then learned modern JavaScript with online courses and small projects of my own.',
  },
];

interface DemoOffer {
  title: string; company: string; city: string; email: string; score: number; text: string;
  /** The points in English and German (the language of the demo decides). */
  why: string[]; missing: string[]; whyDe: string[]; missingDe: string[];
}

/** Fictional offers (Muster/Beispiel companies, example.com addresses), scored the way the AI helper would. */
const OFFERS: DemoOffer[] = [
  {
    title: 'Frontend-Entwickler (m/w/d)', company: 'Musterfirma Digital GmbH', city: 'Berlin', email: 'jobs@musterfirma.example.com', score: 88,
    why: ['Web developer since 2018, with the asked skills (JavaScript, CSS, WordPress).', 'Berlin, full time — as in your job wishes.'], missing: [],
    whyDe: ['Webentwickler seit 2018, mit den gesuchten Kenntnissen (JavaScript, CSS, WordPress).', 'Berlin, Vollzeit — wie in Ihren Jobwünschen.'], missingDe: [],
    text: `Frontend-Entwickler (m/w/d)
Musterfirma Digital GmbH
Musterweg 5, 10115 Berlin

Wir suchen zum nächstmöglichen Zeitpunkt eine:n Frontend-Entwickler:in in Vollzeit.

Ihre Aufgaben:
- Entwicklung moderner Weboberflächen mit HTML, CSS und JavaScript
- Umsetzung von Designvorlagen in responsive Websites
- Pflege unserer WordPress-Projekte

Ihr Profil:
- Erfahrung mit HTML, CSS, JavaScript und WordPress
- Freude an der Arbeit im Team

Bitte senden Sie Ihre Bewerbung an: jobs@musterfirma.example.com`,
  },
  {
    title: 'Webentwickler WordPress (m/w/d)', company: 'Beispiel Medien GmbH', city: 'Potsdam', email: 'karriere@beispiel-medien.example.com', score: 71,
    why: ['WordPress and CSS fit the tasks well.'], missing: ['PHP is asked for; your profile does not mention it.'],
    whyDe: ['WordPress und CSS passen gut zu den Aufgaben.'], missingDe: ['PHP wird verlangt; Ihr Profil nennt es nicht.'],
    text: `Webentwickler WordPress (m/w/d)
Beispiel Medien GmbH
Beispielstraße 12, 14467 Potsdam

Für unsere Kundenprojekte suchen wir Verstärkung in Vollzeit.

Ihre Aufgaben:
- Entwicklung und Pflege von WordPress-Websites
- Eigene Themes und Plugins mit PHP

Ihr Profil:
- Gute Kenntnisse in WordPress, PHP und CSS

Bewerbungen bitte an: karriere@beispiel-medien.example.com`,
  },
  {
    title: 'Fullstack-Entwickler Java (m/w/d)', company: 'Muster Software AG', city: 'Berlin', email: 'bewerbung@muster-software.example.com', score: 42,
    why: ['Web development experience helps with the frontend part.'], missing: ['Java and Spring are required; your profile has neither.', 'Three years of backend work are asked for.'],
    whyDe: ['Die Erfahrung in der Webentwicklung hilft beim Frontend-Teil.'], missingDe: ['Java und Spring werden verlangt; Ihr Profil hat beides nicht.', 'Drei Jahre Backend-Erfahrung werden erwartet.'],
    text: `Fullstack-Entwickler Java (m/w/d)
Muster Software AG
Musterallee 1, 10117 Berlin

Ihre Aufgaben:
- Backend-Entwicklung mit Java und Spring Boot
- Frontends mit React

Ihr Profil:
- Mindestens drei Jahre Erfahrung mit Java im Backend

Kontakt: bewerbung@muster-software.example.com`,
  },
];

/** The points are in German for a German demo, else in English (the card then offers "Score again"). */
function offerCard(o: DemoOffer, id: string, now: string, language: Language): Vacancy {
  const de = language === 'de';
  return {
    id, source: 'manual', sourceId: null, addedManually: true, title: o.title, company: o.company, locations: [o.city],
    remote: 'no', employment: ['fulltime'], salaryText: '', publishedAt: now.slice(0, 10), foundAt: now, url: '',
    contact: { email: o.email, salutation: '', name: '', phone: '', street: '', postcode: '', city: '' },
    hasText: false, status: 'new', scoreState: 'scored',
    score: { value: o.score, why: de ? o.whyDe : o.why, missing: de ? o.missingDe : o.missing, scoredAt: now, provider: 'claude', language: de ? 'de' : 'en' },
    hiddenAt: null,
  };
}

/**
 * First start of the demo: a ready profile, three scored offers, finished onboarding, Claude chosen (scripted) and a mailbox.
 * Later starts keep the demo as the person left it.
 */
export async function seedDemo(d: { settings: SettingsStore; profileStore: ProfileStore; vacancyStore: VacancyStore; secrets: SecretStore; language: Language }): Promise<void> {
  if (d.profileStore.get().sections.personal.data.fullName !== '') return;
  let n = 0;
  const newId = () => `demo${++n}`;
  const now = new Date().toISOString();
  const data = toSectionData(FICTIONAL_CV, newId);
  d.profileStore.update((p: Profile) => {
    for (const id of ['personal', 'education', 'experience', 'skills', 'languages'] as const) {
      p.sections[id] = { data: data[id] as never, aiFields: [], confirmedAt: now, editedAt: null };
    }
    p.sections.wishes = {
      data: {
        jobTitles: ['Webentwickler', 'Frontend-Entwickler'], locations: ['Berlin'], radiusKm: 25, remote: 'any',
        employmentTypes: ['fulltime'], salaryMinEur: null, availableFrom: '', notes: '', includeTemporaryAgencies: false,
      },
      aiFields: [], confirmedAt: now, editedAt: null,
    };
    p.stories = STORIES.map((s) => ({ ...s, id: newId() }));
    p.wizard = { step: 4, completedAt: now };
  });
  d.settings.patch({ language: d.language, onboarding: { currentStep: null, completed: true }, llm: { provider: 'claude' } });
  d.settings.setMail({
    kind: 'smtp', address: 'max.mustermann@example.com', senderName: 'Max Mustermann', host: 'smtp.example.com', port: 465,
    security: 'ssl', user: 'max.mustermann@example.com', provider: 'other',
  });
  OFFERS.forEach((o, i) => d.vacancyStore.add(offerCard(o, `demo-offer-${i + 1}`, now, d.language), o.text));
  await d.secrets.save('demo-password-not-used');
}

type Spawn = (file: string, args: string[], opts: { env?: NodeJS.ProcessEnv; windowsHide?: boolean }) => void;

export interface DemoLauncherDeps {
  /** The person's own data folder; the demo uses `demo/` inside it. */
  dataRoot: string;
  /** server/dist/index.js of this installation. */
  entry: string;
  spawn: Spawn;
  /** The demo copy's server, if it runs (findRunningInstance on its server.json). */
  find: () => Promise<RunningInstance | null>;
  waitMs?: number;
  intervalMs?: number;
}

export class DemoLauncher {
  constructor(private readonly d: DemoLauncherDeps) {}

  /** Starts the demo copy (or reuses a running one) and answers with the address that opens it in the browser. */
  async start(language: Language): Promise<{ url: string }> {
    let running = await this.d.find();
    if (running === null) {
      this.d.spawn(process.execPath, [this.d.entry, '--demo', '--no-open'], {
        env: { ...process.env, BP_DATA_DIR: demoDataRoot(this.d.dataRoot), BP_DEMO_LANGUAGE: language },
        windowsHide: true,
      });
      const deadline = Date.now() + (this.d.waitMs ?? 30_000);
      while (running === null && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, this.d.intervalMs ?? 250));
        running = await this.d.find();
      }
    }
    if (running === null) throw new AppError('DEMO_FAILED', 'the demo copy did not start in time');
    return { url: openUrl(HOST, running.port, running.key) };
  }
}
