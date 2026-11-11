import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

export interface DownloadItem { key: string; label: string; onPick: () => void }

/**
 * One "Download ▾" button instead of a row of buttons (one per attachment made it 8+ with five attachments).
 * Opens a small panel: the whole application as one PDF first (what usually goes to the employer), then each file
 * separately. A disclosure (button + panel), not an ARIA menu: plain buttons inside, Tab works as everywhere else.
 * Closes on Escape (focus back on the button), on a click outside and after a choice.
 */
export function DownloadMenu({ bundle, separate, disabled, busy }: {
  bundle: () => void; separate: DownloadItem[]; disabled: boolean; busy: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);

  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (root.current && !root.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); toggle.current?.focus(); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const pick = (fn: () => void) => { setOpen(false); fn(); };

  return (
    <div className="download-menu" ref={root}>
      <button ref={toggle} type="button" className="btn ghost" aria-expanded={open} aria-controls={panelId} disabled={disabled || busy} onClick={() => setOpen((o) => !o)}>
        {busy ? t('applications.download.busy') : t('applications.download.title')} <span aria-hidden="true">▾</span>
      </button>
      {open ? (
        <div id={panelId} className="download-menu__panel" role="group" aria-label={t('applications.download.title')}>
          <button type="button" className="download-menu__item download-menu__item--main" onClick={() => pick(bundle)}>
            <span>{t('applications.download.bundle')}</span>
            <span className="muted download-menu__hint">{t('applications.download.bundleHint')}</span>
          </button>
          <div className="download-menu__sep muted">{t('applications.download.separately')}</div>
          {separate.map((x) => (
            <button key={x.key} type="button" className="download-menu__item" onClick={() => pick(x.onPick)}>{x.label}</button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
