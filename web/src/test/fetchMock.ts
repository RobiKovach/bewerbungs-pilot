import { vi } from 'vitest';

export type RouteHandler = (init?: RequestInit) => { status?: number; body: unknown };

// Routes are keyed "METHOD url", e.g. "GET /api/settings".
export function mockFetch(routes: Record<string, RouteHandler>, opts: { pending?: string[] } = {}) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${url}`;
    if (opts.pending?.includes(key)) {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    }
    const handler = routes[key];
    if (!handler) {
      return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', detailsForLog: key } }), { status: 404 });
    }
    const { status = 200, body } = handler(init);
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}
