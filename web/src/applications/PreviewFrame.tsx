import { useEffect, useRef, useState } from 'react';
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
  const wrap = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: FRAME_PX, height: 1123 });
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
  return (
    <div ref={wrap} className="preview-wrap">
      <iframe className="preview-frame" title={title} sandbox="" src={api.previewUrl(id, kind, version)}
        style={{ width: `${FRAME_PX}px`, height: `${Math.round(box.height / scale)}px`, transform: `scale(${scale})`, transformOrigin: 'top left' }} />
    </div>
  );
}
