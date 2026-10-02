import { describe, it, expect, vi } from 'vitest';
import { download } from './download';

describe('download', () => {
  it('saves the file under the server\'s name', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Blob(['%PDF-1.7']), { status: 200, headers: { 'Content-Disposition': 'attachment; filename="Lebenslauf_Max_Mustermann.pdf"' } })));
    const create = vi.fn(() => 'blob:x');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe('Lebenslauf_Max_Mustermann.pdf');
      expect(this.href).toBe('blob:x');
    });
    await download('/api/applications/app1/pdf/cv', 'cv.pdf');
    expect(click).toHaveBeenCalledOnce();
  });
  it('an error answer becomes an ApiError with code and reason', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'CONFLICT', detailsForLog: 'x', reason: 'attachmentUnreadable', params: { name: 'Zeugnis' } } }), { status: 409 })));
    await expect(download('/x', 'x.pdf')).rejects.toMatchObject({ code: 'CONFLICT', reason: 'attachmentUnreadable', params: { name: 'Zeugnis' } });
  });
});
