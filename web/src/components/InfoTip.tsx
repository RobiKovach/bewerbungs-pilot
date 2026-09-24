import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

export function InfoTip({ textKey }: { textKey: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className="infotip">
      <button type="button" className="infotip-btn" aria-label={t('common.moreInfo')} aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        ⓘ
      </button>
      {open ? <span id={id} role="note" className="infotip-text">{t(textKey)}</span> : null}
    </span>
  );
}
