import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';

/** Width of an A4 page at 96 dpi (210 mm). */
export const A4_PX = 794;
/**
 * The frame is wider than the page by a scrollbar: a long document gets a vertical scrollbar inside the frame (a classic
 * Windows one takes about 17 px), and with a frame exactly one page wide that would push the page sideways.
 */
export const FRAME_PX = A4_PX + 20;

/** The server's own HTML of the document, exactly as it will be printed, scaled to the column's width. No scripts: sandbox with no permissions. */
export function PreviewFrame({ id, kind, version, title }: { id: string; kind: 'letter' | 'cv'; version: string; title: string }) {
  const { t } = useTranslation();
  const wrap = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const [box, setBox] = useState({ width: FRAME_PX, height: 1123 });
  const [full, setFull] = useState(false);
  useEffect(() => {
    const el = wrap.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setBox({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const scale = Math.min(1, box.width / FRAME_PX) || 1;
  const src = api.previewUrl(id, kind, version);
  const close = useCallback(() => { setFull(false); opener.current?.focus(); }, []);
  return (
    <div className="preview-col">
      <div className="preview-tools">
        <button ref={opener} type="button" className="btn small ghost" onClick={() => setFull(true)}>{t('applications.fullScreen')}</button>
      </div>
      <div ref={wrap} className="preview-wrap">
        <iframe className="preview-frame" title={title} sandbox="" src={src}
          style={{ width: `${FRAME_PX}px`, height: `${Math.round(box.height / scale)}px`, transform: `scale(${scale})`, transformOrigin: 'top left' }} />
      </div>
      {full ? <FullScreen title={title} src={src} onClose={close} /> : null}
    </div>
  );
}

/** The same page at its natural size over the whole window; Esc or the button closes it. */
function FullScreen({ title, src, onClose }: { title: string; src: string; onClose: () => void }) {
  const { t } = useTranslation();
  const closeBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="preview-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="preview-overlay__bar">
        <strong>{title}</strong>
        <button ref={closeBtn} type="button" className="btn small" onClick={onClose}>{t('applications.closeFullScreen')}</button>
      </div>
      <iframe className="preview-frame preview-overlay__frame" title={`${title} (${t('applications.fullScreen')})`} sandbox="" src={src} style={{ width: `${FRAME_PX}px` }} />
    </div>
  );
}
