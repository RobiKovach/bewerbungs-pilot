import fs from 'node:fs';
import type { ApplicationListView, ApplicationPackage, ApplicationView, AttachmentInfo, Profile, SubmittedInfo, Vacancy } from '@bp/shared';
import type { ProfileFiles } from '../profile/files.js';
import { exportedAt } from '../nachweis/rows.js';
import { followUpDue } from './follow-up.js';
import { attachmentFileName, fileNames } from './render/html.js';
import { allowedFor, findPersonalData, packageTexts } from './personal-data.js';
import { currentFacts, profileFingerprint } from './snapshot.js';
import { canUndo, isFrozen } from './status.js';
import type { ApplicationStore, PhotoFile } from './store.js';

/**
 * "Company facts appeared — Create again" (spec 3.4): the card's non-hidden facts differ from the package's snapshot.
 * Never for a sent package (it cannot be created again) or when the card is gone.
 */
export function factsChanged(p: ApplicationPackage, vacancy: Vacancy | undefined): boolean {
  if (!vacancy || isFrozen(p)) return false;
  const now = currentFacts(vacancy);
  const then = p.vacancy.facts ?? [];
  return now.length !== then.length || now.some((x, i) => x !== then[i]);
}

/** The recipient e-mail the app found by itself and the person has not confirmed yet → its domain (spec, section 7). */
export function recipientAuto(p: ApplicationPackage): { domain: string } | null {
  const email = p.vacancy.contact?.email.trim() ?? '';
  const at = email.lastIndexOf('@');
  if (!(p.vacancy.contactAuto ?? []).includes('email') || at < 0) return null;
  return { domain: email.slice(at + 1).toLowerCase() };
}

/** `vacancy`: the live card (undefined = gone), only for `factsChanged`. */
export function toView(p: ApplicationPackage, profile: Profile, now: Date, vacancyText: string | null, vacancy: Vacancy | undefined): ApplicationView {
  const known = new Set(profile.documents.map((d) => d.id));
  const attachments: AttachmentInfo[] = [
    ...profile.documents.map((d) => ({ id: d.id, label: d.label || d.originalName, size: d.size, selected: p.attachments.includes(d.id), missing: false })),
    ...p.attachments.filter((id) => !known.has(id)).map((id) => ({ id, label: '', size: 0, selected: true, missing: true })),
  ];
  return {
    application: p, profileChanged: !isFrozen(p) && profileFingerprint(profile) !== p.profileFingerprint, attachments, canUndo: canUndo(p), followUpDue: followUpDue(p, now),
    warnings: warningsFor(p, profile, vacancyText), factsChanged: factsChanged(p, vacancy), recipientAuto: recipientAuto(p),
    downloadNames: {
      ...fileNames(p.snapshot.personal.fullName, p.vacancy.company, p.language),
      attachments: Object.fromEntries(profile.documents.map((d) => [d.id, attachmentFileName(d)])),
    },
  };
}

/** Only a hint: a bug in the check must never fail the package view (or the answer to a send that went out). */
function warningsFor(p: ApplicationPackage, profile: Profile, vacancyText: string | null) {
  try {
    return findPersonalData(packageTexts(p), allowedFor(p, profile, vacancyText));
  } catch {
    return [];
  }
}

const changed = (p: ApplicationPackage | undefined, current: string) => !p || (!isFrozen(p) && p.profileFingerprint !== current);

/** Derived from the history, never stored: the vacancies page shows these vacancies in their own tab. */
export function submittedOf(p: ApplicationPackage): SubmittedInfo | null {
  const first = p.history.find((h) => h.kind === 'sent' || h.kind === 'submitted');
  return first ? { via: first.kind === 'sent' ? 'mail' : 'site', at: first.at } : null;
}

export function toListView(store: ApplicationStore, profile: Profile, now: Date): ApplicationListView {
  const current = profileFingerprint(profile);
  return {
    applications: store.list().map((s) => {
      const p = store.get(s.id);
      return { ...s, profileChanged: changed(p, current), followUpDue: p ? followUpDue(p, now) : false, submitted: p ? submittedOf(p) : null, nachweisAt: p ? exportedAt(p) : null };
    }),
  };
}

/** The profile photo's bytes for a package copy; null when there is none or its file is gone. */
export function profilePhoto(profile: Profile, files: ProfileFiles): PhotoFile | null {
  const photo = profile.photo;
  if (!photo || (photo.ext !== '.jpg' && photo.ext !== '.png')) return null;
  try {
    return { data: fs.readFileSync(files.pathOf(photo)), ext: photo.ext };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}
