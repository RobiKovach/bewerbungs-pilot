import { describe, it, expect, vi } from 'vitest';
import { api, ApiError } from './api';
import { mockFetch } from './test/fetchMock';
import { baseSettings } from './test/fixtures';

describe('api', () => {
  it('sends JSON with the client header', async () => {
    const f = mockFetch({ 'PATCH /api/settings': () => ({ body: baseSettings({ language: 'uk' }) }) });
    await expect(api.patchSettings({ language: 'uk' })).resolves.toMatchObject({ language: 'uk' });
    const init = f.mock.calls[0][1] as RequestInit;
    expect(init.headers).toMatchObject({ 'X-BP-Client': '1', 'Content-Type': 'application/json' });
    expect(init.body).toBe(JSON.stringify({ language: 'uk' }));
  });
  it('turns server errors into ApiError codes', async () => {
    mockFetch({ 'POST /api/llm/test': () => ({ status: 504, body: { error: { code: 'LLM_TIMEOUT', detailsForLog: 'slow' } } }) });
    await expect(api.testLlm('en')).rejects.toMatchObject({ code: 'LLM_TIMEOUT', details: 'slow' });
  });
  it('reports an unreachable server', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const err = await api.getSettings().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('SERVER_UNREACHABLE');
  });
  it('asks for a fresh Claude check only when told to', async () => {
    const f = mockFetch({
      'GET /api/llm/check': () => ({ body: { availability: { ok: true }, queue: { running: false, queued: 0 } } }),
      'GET /api/llm/check?refresh=1': () => ({ body: { availability: { ok: true }, queue: { running: false, queued: 0 } } }),
    });
    await api.checkLlm();
    await api.checkLlm(true);
    expect(f.mock.calls.map((c) => c[0])).toEqual(['/api/llm/check', '/api/llm/check?refresh=1']);
  });
});
