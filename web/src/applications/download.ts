import { ApiError, reportNoSession } from '../api';
import type { ErrorReason } from '../types';
import { saveFile, type SaveResult } from '../files/save';

/**
 * GET a generated PDF and save it where the person chooses ("Save as", 0.13.1) or into the downloads; an error answer
 * becomes an ApiError (shown with ErrorBanner). `name` is the server's name for the file, suggested in the window.
 */
export async function download(url: string, name: string): Promise<SaveResult> {
  return saveFile({ suggestedName: name, kind: 'pdf', make: () => fetch(url) });
}

/**
 * Reads the whole answer: the file and the server's name for it. An error answer becomes an ApiError. A body that breaks off
 * half way (the program was stopped or updated meanwhile) is a failure too, so a cut-off file is never taken for a whole one.
 */
export async function readFile(res: Response, fallbackName: string): Promise<{ blob: Blob; name: string }> {
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: { code?: string; detailsForLog?: string; reason?: ErrorReason; params?: Record<string, string | number> } } | null;
    reportNoSession(res.status, data?.error?.code);
    throw new ApiError(data?.error?.code ?? 'UNKNOWN', data?.error?.detailsForLog ?? `HTTP ${res.status}`, data?.error?.reason, data?.error?.params);
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? fallbackName;
  try {
    return { blob: await res.blob(), name };
  } catch (err) {
    throw new ApiError('SERVER_UNREACHABLE', String(err));
  }
}

/** Saves the answer into the browser's downloads under the server's name; nothing is saved when reading fails (see readFile). */
export async function downloadResponse(res: Response, fallbackName: string): Promise<void> {
  const { blob, name } = await readFile(res, fallbackName);
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
}
