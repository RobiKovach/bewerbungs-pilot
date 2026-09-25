import { createContext, useCallback, useContext, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

type Report = (formId: string, dirty: boolean) => void;
const UnsavedContext = createContext<{ report: Report; hasUnsaved: boolean } | null>(null);

/**
 * Collects "this form has unsaved changes" from the forms inside it (one wizard step), so the wizard can
 * hold Next/Back until they are saved or undone — leaving the step would throw the drafts away.
 */
export function UnsavedProvider({ children }: { children: ReactNode }) {
  const [dirtyForms, setDirtyForms] = useState<ReadonlySet<string>>(new Set());
  const report = useCallback<Report>((formId, dirty) => setDirtyForms((prev) => {
    if (prev.has(formId) === dirty) return prev;
    const next = new Set(prev);
    if (dirty) next.add(formId); else next.delete(formId);
    return next;
  }), []);
  const value = useMemo(() => ({ report, hasUnsaved: dirtyForms.size > 0 }), [report, dirtyForms]);
  return <UnsavedContext.Provider value={value}>{children}</UnsavedContext.Provider>;
}

/** A form tells the surrounding step whether it has unsaved changes. Does nothing outside the wizard. */
export function useReportUnsaved(dirty: boolean): void {
  const report = useContext(UnsavedContext)?.report;
  const formId = useId();
  useEffect(() => {
    if (!report) return undefined;
    report(formId, dirty);
    return () => report(formId, false);
  }, [report, formId, dirty]);
}

export const useHasUnsaved = (): boolean => useContext(UnsavedContext)?.hasUnsaved ?? false;

/** A step's "Next" button: held back, with a hint, while a form in the step has unsaved changes. */
export function NextButton({ onNext, labelKey }: { onNext: () => void; labelKey: string }) {
  const { t } = useTranslation();
  const blocked = useHasUnsaved();
  return (
    <>
      {blocked ? <p className="notice">{t('profile.unsavedHint')}</p> : null}
      <div className="btn-row"><button type="button" className="btn" disabled={blocked} onClick={onNext}>{t(labelKey)}</button></div>
    </>
  );
}
