import { createContext, useCallback, useContext, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

type Report = (formId: string, dirty: boolean) => void;
const UnsavedContext = createContext<{ report: Report; hasUnsaved: boolean } | null>(null);

/**
 * Collects "this form has unsaved changes" from the forms inside it (one wizard step), so the wizard can
 * hold Next/Back until they are saved or undone — leaving the step would throw the drafts away.
 * Providers nest: each one also reports to the one around it, so the app-wide one (App) knows about every form.
 */
export function UnsavedProvider({ children, onChange }: { children: ReactNode; onChange?: (hasUnsaved: boolean) => void }) {
  const [dirtyForms, setDirtyForms] = useState<ReadonlySet<string>>(new Set());
  const report = useCallback<Report>((formId, dirty) => setDirtyForms((prev) => {
    if (prev.has(formId) === dirty) return prev;
    const next = new Set(prev);
    if (dirty) next.add(formId); else next.delete(formId);
    return next;
  }), []);
  const hasUnsaved = dirtyForms.size > 0;
  useReportUnsaved(hasUnsaved); // to the surrounding provider (this runs outside our own Provider)
  useEffect(() => { onChange?.(hasUnsaved); }, [onChange, hasUnsaved]);
  const value = useMemo(() => ({ report, hasUnsaved }), [report, hasUnsaved]);
  return <UnsavedContext.Provider value={value}>{children}</UnsavedContext.Provider>;
}

/** A form tells the surrounding step (and the app) whether it has unsaved changes. Does nothing outside any provider. */
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
