import fs from 'node:fs';
import type { ApplicationListView, ApplicationPackage, ApplicationView, AttachmentInfo, Profile } from '@bp/shared';
import type { ProfileFiles } from '../profile/files.js';
import { profileFingerprint } from './snapshot.js';
import type { ApplicationStore, PhotoFile } from './store.js';

export function toView(p: ApplicationPackage, profile: Profile): ApplicationView {
  const known = new Set(profile.documents.map((d) => d.id));
  const attachments: AttachmentInfo[] = [
    ...profile.documents.map((d) => ({ id: d.id, label: d.label || d.originalName, size: d.size, selected: p.attachments.includes(d.id), missing: false })),
    ...p.attachments.filter((id) => !known.has(id)).map((id) => ({ id, label: '', size: 0, selected: true, missing: true })),
  ];
  return { application: p, profileChanged: profileFingerprint(profile) !== p.profileFingerprint, attachments };
}

export function toListView(store: ApplicationStore, profile: Profile): ApplicationListView {
  const current = profileFingerprint(profile);
  return {
    applications: store.list().map((s) => ({ ...s, profileChanged: store.get(s.id)?.profileFingerprint !== current })),
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
