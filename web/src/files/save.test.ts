import { afterEach, describe, it, expect, vi } from 'vitest';
import { ApiError } from '../api';
import { saveFile } from './save';

/** A fake "Save as" handle: records what was written; `failWrite` makes the write fail (USB stick pulled). */
function fakeHandle(opts: { failWrite?: boolean } = {}) {
  const written: unknown[] = [];
  const calls: string[] = [];
  const writable = {
    write: vi.fn(async (data: unknown) => { calls.push('write'); if (opts.failWrite) throw new Error('NotReadableError: device gone'); written.push(data); }),
    close: vi.fn(async () => { calls.push('close'); }),
    abort: vi.fn(async () => { calls.push('abort'); }),
  };
  const handle = { createWritable: vi.fn(async () => { calls.push('createWritable'); return writable; }), remove: vi.fn(async () => { calls.push('remove'); }) };
  return { handle, writable, written, calls };
}

const pdf = () => new Response('%PDF-1.7', { status: 200, headers: { 'Content-Disposition': 'attachment; filename="Lebenslauf_Max.pdf"' } });

afterEach(() => {
  delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  vi.restoreAllMocks();
});

describe('saveFile with the "Save as" window', () => {
  it('opens the window before the file is made, then writes the whole file and closes it', async () => {
    const order: string[] = [];
    const h = fakeHandle();
    const picker = vi.fn(async () => { order.push('picker'); return h.handle; });
    (window as { showSaveFilePicker?: unknown }).showSaveFilePicker = picker;
    const make = vi.fn(async () => { order.push('fetch'); return pdf(); });
    const result = await saveFile({ suggestedName: 'Lebenslauf_Max.pdf', kind: 'pdf', make });
    expect(result).toBe('saved');
    expect(order).toEqual(['picker', 'fetch']);
    expect(picker).toHaveBeenCalledWith(expect.objectContaining({ suggestedName: 'Lebenslauf_Max.pdf' }));
    expect(h.calls).toEqual(['createWritable', 'write', 'close']);
    expect(h.written).toHaveLength(1);
    expect(await (h.written[0] as Blob).text()).toBe('%PDF-1.7');
  });

  it('cancel: nothing is made, no error', async () => {
    (window as { showSaveFilePicker?: unknown }).showSaveFilePicker = vi.fn(async () => { throw new DOMException('The user aborted a request.', 'AbortError'); });
    const make = vi.fn(async () => pdf());
    await expect(saveFile({ suggestedName: 'x.pdf', kind: 'pdf', make })).resolves.toBe('cancelled');
    expect(make).not.toHaveBeenCalled();
  });

  it('the file could not be made: the server error is shown, nothing written, the empty file is removed', async () => {
    const h = fakeHandle();
    (window as { showSaveFilePicker?: unknown }).showSaveFilePicker = vi.fn(async () => h.handle);
    const make = vi.fn(async () => new Response(JSON.stringify({ error: { code: 'BROWSER_MISSING', detailsForLog: 'x' } }), { status: 500 }));
    await expect(saveFile({ suggestedName: 'x.pdf', kind: 'pdf', make })).rejects.toMatchObject({ code: 'BROWSER_MISSING' });
    expect(h.handle.createWritable).not.toHaveBeenCalled();
    expect(h.handle.remove).toHaveBeenCalledOnce();
  });

  it('the program is not reachable after the window: SERVER_UNREACHABLE, empty file removed', async () => {
    const h = fakeHandle();
    (window as { showSaveFilePicker?: unknown }).showSaveFilePicker = vi.fn(async () => h.handle);
    const make = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    await expect(saveFile({ suggestedName: 'x.pdf', kind: 'pdf', make })).rejects.toMatchObject({ code: 'SERVER_UNREACHABLE' });
    expect(h.handle.remove).toHaveBeenCalledOnce();
  });

  it('writing fails (stick pulled, disk full): FILE_SAVE_FAILED, the write is aborted', async () => {
    const h = fakeHandle({ failWrite: true });
    (window as { showSaveFilePicker?: unknown }).showSaveFilePicker = vi.fn(async () => h.handle);
    const err = await saveFile({ suggestedName: 'x.pdf', kind: 'pdf', make: async () => pdf() }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('FILE_SAVE_FAILED');
    expect(h.writable.abort).toHaveBeenCalledOnce();
    expect(h.handle.remove).toHaveBeenCalledOnce();
  });

  it('a browser that refuses the window for another reason (no click, blocked): falls back to the download', async () => {
    (window as { showSaveFilePicker?: unknown }).showSaveFilePicker = vi.fn(async () => { throw new DOMException('Must be handling a user gesture', 'SecurityError'); });
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await expect(saveFile({ suggestedName: 'x.pdf', kind: 'pdf', make: async () => pdf() })).resolves.toBe('downloaded');
    expect(click).toHaveBeenCalledOnce();
  });
});

describe('saveFile without the "Save as" window (Firefox, old browser)', () => {
  it('downloads under the server name, as before', async () => {
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe('Lebenslauf_Max.pdf');
    });
    await expect(saveFile({ suggestedName: 'other.pdf', kind: 'pdf', make: async () => pdf() })).resolves.toBe('downloaded');
    expect(click).toHaveBeenCalledOnce();
  });

  it('a body that breaks off is not saved', async () => {
    const broken = new Response(new ReadableStream({ start(c) { c.error(new Error('aborted')); } }), { status: 200 });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await expect(saveFile({ suggestedName: 'x.zip', kind: 'zip', make: async () => broken })).rejects.toMatchObject({ code: 'SERVER_UNREACHABLE' });
    expect(click).not.toHaveBeenCalled();
  });
});
