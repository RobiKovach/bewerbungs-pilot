import fs from 'node:fs';
import type { ApplicationListView, ApplicationPackage, ApplicationView, AttachmentInfo, Profile } from '@bp/shared';
import type { ProfileFiles } from '../profile/files.js';
import { followUpDue } from './follow-up.js';
import { allowedFor, findPersonalData, packageTexts } from './personal-data.js';
import { profileFingerprint } from './snapshot.js';
import { canUndo, isFrozen } from './status.js';
import type { ApplicationStore, PhotoFile } from './store.js';

export function toView(p: ApplicationPackage, profile: Profile, now: Date, vacancyText: string | null): ApplicationView {
  const known = new Set(profile.documents.map((d) => d.id));
  const attachments: AttachmentInfo[] = [
    ...profile.documents.map((d) => ({ id: d.id, label: d.label || d.originalName, size: d.size, selected: p.attachments.includes(d.id), missing: false })),
    ...p.attachments.filter((id) => !known.has(id)).map((id) => ({ id, label: '', size: 0, selected: true, missing: true })),
  ];
  return {
    application: p, profileChanged: !isFrozen(p) && profileFingerprint(profile) !== p.profileFingerprint, attachments, canUndo: canUndo(p), followUpDue: followUpDue(p, now),
    warnings: warningsFor(p, profile, vacancyText),
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

export function toListView(store: ApplicationStore, profile: Profile, now: Date): ApplicationListView {
  const current = profileFingerprint(profile);
  return {
    applications: store.list().map((s) => {
      const p = store.get(s.id);
      return { ...s, profileChanged: changed(p, current), followUpDue: p ? followUpDue(p, now) : false };
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
