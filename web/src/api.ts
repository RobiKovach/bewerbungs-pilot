import type { Language, LlmCheck, Settings, SettingsPatch } from './types';

export class ApiError extends Error {
  constructor(public readonly code: string, public readonly details: string) {
    super(code);
    this.name = 'ApiError';
  }
}

async function request<T>(method: string, url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const headers: Record<string, string> = { 'X-BP-Client': '1' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError('SERVER_UNREACHABLE', String(err));
  }
  const data = (await res.json().catch(() => null)) as { error?: { code?: string; detailsForLog?: string } } | null;
  if (!res.ok) throw new ApiError(data?.error?.code ?? 'UNKNOWN', data?.error?.detailsForLog ?? `HTTP ${res.status}`);
  return data as T;
}

export const api = {
  getSettings: () => request<Settings>('GET', '/api/settings'),
  patchSettings: (patch: SettingsPatch) => request<Settings>('PATCH', '/api/settings', patch),
  checkLlm: (refresh = false) => request<LlmCheck>('GET', `/api/llm/check${refresh ? '?refresh=1' : ''}`),
  testLlm: (language: Language, signal?: AbortSignal) => request<{ greeting: string }>('POST', '/api/llm/test', { language }, signal),
  openLogin: () => request<{ ok: true }>('POST', '/api/llm/open-login', {}),
  shutdown: () => request<{ ok: true }>('POST', '/api/shutdown', {}),
};
