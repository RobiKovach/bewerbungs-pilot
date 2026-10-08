import type {
  ApplicationJobState, ApplicationListView, ApplicationView, DocLanguage, LetterPatch, NewPackageInfo, PackageReadiness,
  CvResult, CvSectionId, ErrorReason, Language, LlmCheck, MailProvider, MailSecurity, MailSettingsView, ManualEdit, ManualInput, ProfileView, SearchState, SectionDataMap,
  SectionId, Settings, SettingsPatch, StoryAnswer, StoryInput, VacancyListView, VacancyTextView, VacancyView,
} from './types';

/** Password is optional: left out = keep the saved one. Language = the interface language of the test email. */
export interface MailSaveBody {
  address: string; senderName: string; host: string; port: number; security: MailSecurity;
  user: string; password?: string; language: Language;
}

/** What the send dialog starts with (GET send-draft). */
export interface SendDraft {
  to: string; subject: string; body: string; attachments: { name: string; size: number }[]; totalSize: number; mailReady: boolean;
}

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly details: string,
    public readonly reason?: ErrorReason,
    public readonly params?: Record<string, string | number>,
    /** The current state some errors come with (CONFLICT), so the page can show it right away. */
    public readonly view?: ProfileView,
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
    error?: { code?: string; detailsForLog?: string; reason?: ErrorReason; params?: Record<string, string | number> };
    view?: ProfileView;
  } | null;
  if (!res.ok) {
    throw new ApiError(data?.error?.code ?? 'UNKNOWN', data?.error?.detailsForLog ?? `HTTP ${res.status}`, data?.error?.reason, data?.error?.params, data?.view);
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
  getMail: () => request<MailSettingsView>('GET', '/api/mail/settings'),
  mailProviders: () => request<MailProvider[]>('GET', '/api/mail/providers'),
  saveMail: (body: MailSaveBody) => request<MailSettingsView>('PUT', '/api/mail/settings', body),
  disconnectMail: () => request<MailSettingsView>('DELETE', '/api/mail/settings'),
  openLogin: () => request<{ ok: true }>('POST', '/api/llm/open-login', {}),
  shutdown: () => request<{ ok: true }>('POST', '/api/shutdown', {}),

  getProfile: () => request<ProfileView>('GET', '/api/profile'),
  setWizard: (step: 1 | 2 | 3 | 4, completed = false) =>
    request<ProfileView>('PUT', '/api/profile/wizard', completed ? { step, completed } : { step }),
  saveSection: <K extends SectionId>(id: K, data: SectionDataMap[K]) => request<ProfileView>('PUT', `/api/profile/sections/${id}`, { data }),
  confirmSection: (id: SectionId) => request<ProfileView>('POST', `/api/profile/sections/${id}/confirm`, {}),
  /** A new CV's version of a section the person had worked on: take it, or keep their own. */
  /** `seen` = the proposal the page showed (see `proposalSeen`); the server refuses with CONFLICT if it changed since. */
  acceptProposal: (id: CvSectionId, seen: string) => request<ProfileView>('POST', `/api/profile/sections/${id}/proposal/accept`, { seen }),
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

  listVacancies: () => request<VacancyListView>('GET', '/api/vacancies'),
  vacancyText: (id: string) => request<VacancyTextView>('GET', `/api/vacancies/${encodeURIComponent(id)}/text`),
  refreshVacancyText: (id: string, signal?: AbortSignal) => request<VacancyView>('POST', `/api/vacancies/${encodeURIComponent(id)}/text/refresh`, {}, signal),
  setVacancyStatus: (id: string, status: 'new' | 'favorite' | 'hidden', signal?: AbortSignal) =>
    request<VacancyView>('POST', `/api/vacancies/${encodeURIComponent(id)}/status`, { status }, signal),
  scoreVacancy: (id: string, signal?: AbortSignal) => request<VacancyView>('POST', `/api/vacancies/${encodeURIComponent(id)}/score`, {}, signal),
  editVacancy: (id: string, edit: ManualEdit) => request<VacancyView>('PATCH', `/api/vacancies/${encodeURIComponent(id)}`, edit),
  addManualVacancy: (input: ManualInput, signal?: AbortSignal) => request<VacancyView>('POST', '/api/vacancies/manual', input, signal),
  startSearch: () => request<SearchState>('POST', '/api/vacancies/search', {}),
  searchState: () => request<SearchState>('GET', '/api/vacancies/search'),
  stopSearch: () => request<SearchState>('POST', '/api/vacancies/search/stop', {}),
  listApplications: () => request<ApplicationListView>('GET', '/api/applications'),
  newPackageInfo: (vacancyId: string) => request<NewPackageInfo>('GET', `/api/applications/new?vacancyId=${encodeURIComponent(vacancyId)}`),
  packageReadiness: () => request<PackageReadiness>('GET', '/api/applications/readiness'),
  applicationJob: () => request<ApplicationJobState>('GET', '/api/applications/job'),
  cancelApplicationJob: () => request<ApplicationJobState>('POST', '/api/applications/job/cancel', {}),
  createPackage: (vacancyId: string, language: DocLanguage) => request<ApplicationJobState>('POST', '/api/applications', { vacancyId, language }),
  getApplication: (id: string) => request<ApplicationView>('GET', `/api/applications/${encodeURIComponent(id)}`),
  patchLetter: (id: string, patch: LetterPatch) => request<ApplicationView>('PATCH', `/api/applications/${encodeURIComponent(id)}/letter`, patch),
  patchProfil: (id: string, profil: string) => request<ApplicationView>('PATCH', `/api/applications/${encodeURIComponent(id)}/cv-profil`, { profil }),
  patchHeadline: (id: string, headline: string) => request<ApplicationView>('PATCH', `/api/applications/${encodeURIComponent(id)}/cv-headline`, { headline }),
  setAttachments: (id: string, ids: string[]) => request<ApplicationView>('PATCH', `/api/applications/${encodeURIComponent(id)}/attachments`, { ids }),
  reviseLetter: (id: string, instruction: string) => request<ApplicationJobState>('POST', `/api/applications/${encodeURIComponent(id)}/revise`, { instruction }),
  refreshCv: (id: string, keepProfil: boolean, keepHeadline: boolean) => request<ApplicationJobState>('POST', `/api/applications/${encodeURIComponent(id)}/refresh-cv`, { keepProfil, keepHeadline }),
  recreatePackage: (id: string, language: DocLanguage) => request<ApplicationJobState>('POST', `/api/applications/${encodeURIComponent(id)}/recreate`, { language }),
  approveApplication: (id: string) => request<ApplicationView>('POST', `/api/applications/${encodeURIComponent(id)}/approve`, {}),
  recountPages: (id: string) => request<ApplicationView>('POST', `/api/applications/${encodeURIComponent(id)}/recount`, {}),
  unapproveApplication: (id: string) => request<ApplicationView>('POST', `/api/applications/${encodeURIComponent(id)}/unapprove`, {}),
  deleteApplication: (id: string) => request<{ ok: true }>('DELETE', `/api/applications/${encodeURIComponent(id)}`),
  sendDraft: (id: string) => request<SendDraft>('GET', `/api/applications/${encodeURIComponent(id)}/send-draft`),
  sendApplication: (id: string, mail: { to: string; subject: string; body: string }) => request<ApplicationView>('POST', `/api/applications/${encodeURIComponent(id)}/send`, mail),
  previewUrl: (id: string, kind: 'letter' | 'cv', version: string) => `/api/applications/${encodeURIComponent(id)}/preview/${kind}?v=${encodeURIComponent(version)}`,
  pdfUrl: (id: string, part: 'letter' | 'cv' | 'bundle') => `/api/applications/${encodeURIComponent(id)}/pdf/${part}`,
  attachmentUrl: (id: string, fileId: string) => `/api/applications/${encodeURIComponent(id)}/pdf/attachment/${encodeURIComponent(fileId)}`,
};
