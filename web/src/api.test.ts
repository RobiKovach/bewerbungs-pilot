import { describe, it, expect, vi } from 'vitest';
import { api, ApiError } from './api';
import { mockFetch } from './test/fetchMock';
import { baseSettings } from './test/fixtures';
import { emptyProfile, viewOf } from './test/profileFixtures';

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
  it('ApiError accepts only known reason ids (a typo does not compile)', () => {
    expect(new ApiError('LLM_TIMEOUT', 'slow', 'llmTimeout').reason).toBe('llmTimeout');
    // @ts-expect-error — not one of the ErrorReason ids
    expect(new ApiError('LLM_TIMEOUT', 'slow', 'llmTimout').reason).toBe('llmTimout');
  });
  it('reports an unreachable server', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const err = await api.getSettings().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('SERVER_UNREACHABLE');
  });
  it('asks for a fresh Claude check only when told to', async () => {
    const f = mockFetch({
      'GET /api/llm/check': () => ({ body: { provider: 'claude', availability: { ok: true }, queue: { running: false, queued: 0 } } }),
      'GET /api/llm/check?refresh=1': () => ({ body: { provider: 'claude', availability: { ok: true }, queue: { running: false, queued: 0 } } }),
      'GET /api/llm/check?provider=chatgpt&refresh=1': () => ({ body: { provider: 'chatgpt', availability: { ok: true }, queue: { running: false, queued: 0 } } }),
    });
    await api.checkLlm();
    await api.checkLlm(undefined, true);
    await api.checkLlm('chatgpt', true);
    expect(f.mock.calls.map((c) => c[0])).toEqual(['/api/llm/check', '/api/llm/check?refresh=1', '/api/llm/check?provider=chatgpt&refresh=1']);
  });
  it('uploads a file as multipart: client header, no JSON content type, name kept', async () => {
    const f = mockFetch({ 'POST /api/profile/cv': () => ({ body: { ...viewOf(emptyProfile()), changedSections: [] } }) });
    await api.uploadCv(new File(['%PDF-1.4'], 'Резюме Ольга.pdf', { type: 'application/pdf' }));
    const init = f.mock.calls[0][1] as RequestInit;
    expect(init.headers).toEqual({ 'X-BP-Client': '1' });
    expect(((init.body as FormData).get('file') as File).name).toBe('Резюме Ольга.pdf');
  });
  it('puts the document label and attach flag into the upload URL', async () => {
    const url = `/api/profile/files?kind=document&label=${encodeURIComponent('Zeugnis & Co')}&attachAlways=1`;
    const f = mockFetch({ [`POST ${url}`]: () => ({ body: viewOf(emptyProfile()) }) });
    await api.uploadDocument(new File(['%PDF'], 'z.pdf'), 'Zeugnis & Co', true);
    expect(f).toHaveBeenCalledOnce();
  });
  it('sends the never-mention list as a JSON array and deletes without a body', async () => {
    const f = mockFetch({
      'PUT /api/profile/never-mention': () => ({ body: viewOf(emptyProfile()) }),
      'DELETE /api/profile/stories/s1': () => ({ body: viewOf(emptyProfile()) }),
    });
    await api.setNeverMention(['Kunde X']);
    await api.deleteStory('s1');
    expect((f.mock.calls[0][1] as RequestInit).body).toBe('["Kunde X"]');
    expect((f.mock.calls[1][1] as RequestInit).body).toBeUndefined();
  });
});
