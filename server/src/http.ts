import type { FastifyReply } from 'fastify';

/** Tab closed / "Cancel" clicked before we answered → stop the work behind this request (Claude, a details request). */
export function abortOnClose(reply: FastifyReply): AbortSignal {
  const ctrl = new AbortController();
  reply.raw.on('close', () => { if (!reply.raw.writableFinished) ctrl.abort(); });
  return ctrl.signal;
}
