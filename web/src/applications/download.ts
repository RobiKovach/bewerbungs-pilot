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
  await downloadResponse(res, fallbackName);
}

/**
 * Saves the answer as a file under the server's name. An error answer becomes an ApiError. A body that breaks off half way
 * (the program was stopped or updated meanwhile) is a failure too: nothing is saved, so a cut-off file is never taken for a whole one.
 */
export async function downloadResponse(res: Response, fallbackName: string): Promise<void> {
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: { code?: string; detailsForLog?: string; reason?: ErrorReason; params?: Record<string, string | number> } } | null;
    reportNoSession(res.status, data?.error?.code);
    throw new ApiError(data?.error?.code ?? 'UNKNOWN', data?.error?.detailsForLog ?? `HTTP ${res.status}`, data?.error?.reason, data?.error?.params);
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? fallbackName;
  let blob: Blob;
  try {
    blob = await res.blob();
  } catch (err) {
    throw new ApiError('SERVER_UNREACHABLE', String(err));
  }
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
}
