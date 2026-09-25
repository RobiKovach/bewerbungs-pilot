import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import type { Profile, StoredFile } from '@bp/shared';
import { AppError } from '../errors.js';
import { CONTENT_TYPES, FILE_ID_PATTERN, MAX_DOCUMENTS, removeQuietly } from './files.js';
import type { ProfileRouteDeps } from './routes.js';
import { LIMITS } from './schema.js';
import { receiveUpload } from './upload.js';
import { toView } from './view.js';

const uploadQuery = {
  type: 'object', additionalProperties: false, required: ['kind'],
  properties: {
    kind: { enum: ['photo', 'document'] },
    label: { type: 'string', maxLength: LIMITS.name },
    attachAlways: { enum: ['0', '1'] },
  },
};
const documentBody = {
  type: 'object', additionalProperties: false, required: ['label', 'attachAlways'],
  properties: { label: { type: 'string', minLength: 1, maxLength: LIMITS.name }, attachAlways: { type: 'boolean' } },
};

function allFiles(p: Profile): StoredFile[] {
  return [...(p.cv ? [p.cv] : []), ...(p.photo ? [p.photo] : []), ...p.documents];
}
const tooManyDocuments = (detailsForLog: string) =>
  new AppError('TOO_MANY_FILES', detailsForLog, 'tooManyDocuments', { max: MAX_DOCUMENTS });
const labelFrom = (name: string) => name.replace(/\.[^.]+$/, '').trim() || name;

export async function registerFileRoutes(app: FastifyInstance, d: ProfileRouteDeps): Promise<void> {
  app.post('/api/profile/files', { schema: { querystring: uploadQuery } }, async (req) => {
    const q = req.query as { kind: 'photo' | 'document'; label?: string; attachAlways?: '0' | '1' };
    // Checked before and after the upload: before, so nobody waits for a file that cannot be kept.
    if (q.kind === 'document' && d.store.get().documents.length >= MAX_DOCUMENTS) {
      throw tooManyDocuments(`already ${MAX_DOCUMENTS} documents`);
    }
    const stored = await receiveUpload(req, d.files, q.kind);
    const oldPhoto = q.kind === 'photo' ? d.store.get().photo : null;
    let profile: Profile;
    try {
      profile = d.store.update((p) => {
        if (q.kind === 'photo') {
          p.photo = stored;
          return;
        }
        if (p.documents.length >= MAX_DOCUMENTS) {
          throw tooManyDocuments('limit reached during upload');
        }
        p.documents.push({ ...stored, label: q.label?.trim() || labelFrom(stored.originalName), attachAlways: q.attachAlways === '1' });
      });
    } catch (err) {
      // Only failures BEFORE the profile commits get here: the new upload is not referenced yet, so it is
      // safe to delete. Once store.update() has succeeded, we fall through to the code below instead.
      d.files.remove(stored);
      throw err;
    }
    // The new photo is now the one the profile points to. Deleting the old one is a courtesy cleanup, not
    // part of the contract: it must never fail the request or delete the new (now-referenced) file.
    if (oldPhoto) removeQuietly(d.files, oldPhoto, d.logger);
    return toView(profile);
  });

  app.put('/api/profile/files/:id', { schema: { body: documentBody } }, async (req) => {
    const { id } = req.params as { id: string };
    const body = req.body as { label: string; attachAlways: boolean };
    return toView(d.store.update((p) => {
      const doc = p.documents.find((x) => x.id === id);
      if (!doc) throw new AppError('NOT_FOUND', `document ${id}`);
      doc.label = body.label.trim() || doc.label;
      doc.attachAlways = body.attachAlways;
    }));
  });

  app.delete('/api/profile/files/:id', async (req) => {
    const { id } = req.params as { id: string };
    const before = d.store.get();
    const file = before.photo?.id === id ? before.photo : before.documents.find((x) => x.id === id);
    if (!file) throw new AppError('NOT_FOUND', `file ${id}`);
    const profile = d.store.update((p) => {
      if (p.photo?.id === id) p.photo = null;
      p.documents = p.documents.filter((x) => x.id !== id);
    });
    // The profile no longer lists the file; deleting it from disk is best-effort (e.g. a Windows lock).
    removeQuietly(d.files, file, d.logger);
    return toView(profile);
  });

  // Read-only: shows the person their own file (photo preview, "Open" for documents and the CV).
  app.get('/api/profile/files/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const file = FILE_ID_PATTERN.test(id) ? allFiles(d.store.get()).find((f) => f.id === id) : undefined;
    if (!file || !d.files.exists(file)) throw new AppError('NOT_FOUND', `file ${id}`);
    reply.header('Content-Type', CONTENT_TYPES[file.ext]);
    reply.header('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(file.originalName)}`);
    reply.header('Cache-Control', 'no-store');
    return reply.send(fs.createReadStream(d.files.pathOf(file)));
  });
}
