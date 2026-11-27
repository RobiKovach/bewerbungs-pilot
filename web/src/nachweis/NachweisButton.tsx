import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { NachweisDialog } from './NachweisDialog';

/** "Bewerbungsnachweis (N new)" on the Applications page; N = submitted applications not exported yet. */
export function NachweisButton({ onChanged }: { onChanged?: () => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [fresh, setFresh] = useState<number | null>(null);
  const count = useCallback(async () => {
    try {
      setFresh((await api.nachweis.get()).candidates.filter((c) => c.exportedAt === null).length);
    } catch {
      setFresh(null); // the button still opens the dialog, which shows the error
    }
  }, []);
  useEffect(() => { void count(); }, [count]);
  return (
    <>
      <div className="btn-row">
        <button type="button" className="btn ghost" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {fresh === null ? t('nachweis.export.button') : t('nachweis.export.buttonCount', { count: fresh })}
        </button>
      </div>
      {open ? <NachweisDialog onClose={() => { setOpen(false); void count(); }} onChanged={() => { void count(); onChanged?.(); }} /> : null}
    </>
  );
}
