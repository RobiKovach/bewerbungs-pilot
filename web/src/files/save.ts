import { ApiError } from '../api';
import { downloadResponse, readFile } from '../applications/download';

/** What happened: written where the person chose, handed to the browser's downloads, or the person closed the window. */
export type SaveResult = 'saved' | 'downloaded' | 'cancelled';

export interface SaveRequest {
  /** Shown in the "Save as" window; the person may change it. */
  suggestedName: string;
  kind: 'pdf' | 'zip';
  /** Asks the server for the file. Called only after the place is chosen (or at once without the window). */
  make: () => Promise<Response>;
}

/** The parts of the File System Access API used here (not in TypeScript's DOM types yet). */
interface Writable { write(data: Blob): Promise<void>; close(): Promise<void>; abort?(): Promise<void> }
interface SaveHandle { createWritable(): Promise<Writable>; getFile?(): Promise<{ size: number }>; remove?(): Promise<void> }
type SavePicker = (options: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<SaveHandle>;

const TYPES: Record<SaveRequest['kind'], { description: string; accept: Record<string, string[]> }> = {
  pdf: { description: 'PDF', accept: { 'application/pdf': ['.pdf'] } },
  zip: { description: 'ZIP', accept: { 'application/zip': ['.zip'] } },
};

async function made(make: () => Promise<Response>): Promise<Response> {
  try {
    return await make();
  } catch (err) {
    throw err instanceof ApiError ? err : new ApiError('SERVER_UNREACHABLE', String(err));
  }
}

/**
 * Saves a file the app makes (0.13.1): with the browser's "Save as" window (Edge, Chrome) the person picks the folder,
 * a USB stick included. The window must open first — browsers allow it only right after a click, and making the file
 * can take a while. Then the whole file is fetched and only then written, so a cut-off or failed file is never left
 * behind (the empty file the window created is removed). Without the window (Firefox, older browsers) — or when the
 * browser refuses it for any reason but the person's own cancel — the file goes to the downloads folder as before.
 */
export async function saveFile(req: SaveRequest): Promise<SaveResult> {
  const picker = (window as { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
  let handle: SaveHandle | null = null;
  if (typeof picker === 'function') {
    try {
      handle = await picker.call(window, { suggestedName: req.suggestedName, types: [TYPES[req.kind]] });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
      handle = null;
    }
  }
  if (!handle) {
    await downloadResponse(await made(req.make), req.suggestedName);
    return 'downloaded';
  }
  // Removes only the empty file the window created: a file the person chose to replace keeps its old content.
  const removeEmpty = async () => {
    try {
      if ((await handle.getFile?.())?.size === 0) await handle.remove?.();
    } catch { /* nothing more to do */ }
  };
  let blob: Blob;
  try {
    ({ blob } = await readFile(await made(req.make), req.suggestedName));
  } catch (err) {
    await removeEmpty();
    throw err;
  }
  let writable: Writable | null = null;
  try {
    writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
  } catch (err) {
    try { await writable?.abort?.(); } catch { /* nothing more to do */ }
    await removeEmpty();
    throw new ApiError('FILE_SAVE_FAILED', String(err));
  }
  return 'saved';
}
