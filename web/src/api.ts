import type {
  CvResult, CvSectionId, Language, LlmCheck, ProfileView, SectionDataMap, SectionId, Settings, SettingsPatch, StoryAnswer,
  StoryInput,
} from './types';

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly details: string,
    public readonly reason?: string,
    public readonly params?: Record<string, string | number>,
  ) {
    super(code);
    this.name = 'ApiError';
  }
}

const CLIENT_HEADER = { 'X-BP-Client': '1' };

async function send<T>(url: string, init: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError('SERVER_UNREACHABLE', String(err));
  }
  const data = (await res.json().catch(() => null)) as {
    error?: { code?: string; detailsForLog?: string; reason?: string; params?: Record<string, string | number> };
  } | null;
  if (!res.ok) {
    throw new ApiError(data?.error?.code ?? 'UNKNOWN', data?.error?.detailsForLog ?? `HTTP ${res.status}`, data?.error?.reason, data?.error?.params);
  }
  return data as T;
}

function request<T>(method: string, url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const headers: Record<string, string> = { ...CLIENT_HEADER };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return send<T>(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal });
}

/** One file as multipart/form-data. No Content-Type header: the browser adds it with the boundary. */
function upload<T>(url: string, file: Blob, filename: string, signal?: AbortSignal): Promise<T> {
  const form = new FormData();
  form.append('file', file, filename);
  return send<T>(url, { method: 'POST', headers: { ...CLIENT_HEADER }, body: form, signal });
}

const fileName = (file: Blob, fallback: string) => (file instanceof File && file.name ? file.name : fallback);

export const api = {
  getSettings: () => request<Settings>('GET', '/api/settings'),
  patchSettings: (patch: SettingsPatch) => request<Settings>('PATCH', '/api/settings', patch),
  checkLlm: (refresh = false) => request<LlmCheck>('GET', `/api/llm/check${refresh ? '?refresh=1' : ''}`),
  testLlm: (language: Language, signal?: AbortSignal) => request<{ greeting: string }>('POST', '/api/llm/test', { language }, signal),
  openLogin: () => request<{ ok: true }>('POST', '/api/llm/open-login', {}),
  shutdown: () => request<{ ok: true }>('POST', '/api/shutdown', {}),

  getProfile: () => request<ProfileView>('GET', '/api/profile'),
  setWizard: (step: 1 | 2 | 3 | 4, completed = false) =>
    request<ProfileView>('PUT', '/api/profile/wizard', completed ? { step, completed } : { step }),
  saveSection: <K extends SectionId>(id: K, data: SectionDataMap[K]) => request<ProfileView>('PUT', `/api/profile/sections/${id}`, { data }),
  confirmSection: (id: SectionId) => request<ProfileView>('POST', `/api/profile/sections/${id}/confirm`, {}),
  /** A new CV's version of a section the person had worked on: take it, or keep their own. */
  acceptProposal: (id: CvSectionId) => request<ProfileView>('POST', `/api/profile/sections/${id}/proposal/accept`, {}),
  rejectProposal: (id: CvSectionId) => request<ProfileView>('POST', `/api/profile/sections/${id}/proposal/reject`, {}),
  uploadCv: (file: File, signal?: AbortSignal) => upload<CvResult>('/api/profile/cv', file, fileName(file, 'cv'), signal),
  askFollowUps: (signal?: AbortSignal) => request<ProfileView>('POST', '/api/profile/followups', {}, signal),
  skipFollowUps: () => request<ProfileView>('DELETE', '/api/profile/followups'),
  structureStories: (answers: StoryAnswer[], signal?: AbortSignal) =>
    request<ProfileView>('POST', '/api/profile/stories/structure', { answers }, signal),
  addStory: (story: StoryInput) => request<ProfileView>('POST', '/api/profile/stories', story),
  saveStory: (id: string, story: StoryInput & { confirmed: boolean }) => request<ProfileView>('PUT', `/api/profile/stories/${id}`, story),
  deleteStory: (id: string) => request<ProfileView>('DELETE', `/api/profile/stories/${id}`),
  setNeverMention: (items: string[]) => request<ProfileView>('PUT', '/api/profile/never-mention', items),
  uploadPhoto: (image: Blob) => upload<ProfileView>('/api/profile/files?kind=photo', image, 'photo.jpg'),
  uploadDocument: (file: File, label: string, attachAlways: boolean) => upload<ProfileView>(
    `/api/profile/files?kind=document&label=${encodeURIComponent(label)}&attachAlways=${attachAlways ? 1 : 0}`, file, fileName(file, 'document.pdf'),
  ),
  saveDocument: (id: string, label: string, attachAlways: boolean) =>
    request<ProfileView>('PUT', `/api/profile/files/${id}`, { label, attachAlways }),
  deleteFile: (id: string) => request<ProfileView>('DELETE', `/api/profile/files/${id}`),
  fileUrl: (id: string) => `/api/profile/files/${id}`,
};
