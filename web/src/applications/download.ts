import { ApiError, reportNoSession } from '../api';
import type { ErrorReason } from '../types';

/** GET a generated file and save it; an error answer becomes an ApiError (shown with ErrorBanner). */
export async function download(url: string, fallbackName: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new ApiError('SERVER_UNREACHABLE', String(err));
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: { code?: string; detailsForLog?: string; reason?: ErrorReason; params?: Record<string, string | number> } } | null;
    reportNoSession(res.status, data?.error?.code);
    throw new ApiError(data?.error?.code ?? 'UNKNOWN', data?.error?.detailsForLog ?? `HTTP ${res.status}`, data?.error?.reason, data?.error?.params);
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? fallbackName;
  const blobUrl = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000);
}
