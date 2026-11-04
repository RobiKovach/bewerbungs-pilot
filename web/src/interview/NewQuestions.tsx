import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { ErrorBanner } from '../components/ErrorBanner';
import { ClaudeWorking } from '../profile/ClaudeWorking';
import type { InterviewPrepView } from '../types';

type InterviewLanguage = InterviewPrepView['defaultLanguage'];
const LANGUAGES: readonly InterviewLanguage[] = ['de', 'en'];

export function LanguageChoice({ value, disabled, onChange }: { value: InterviewLanguage; disabled?: boolean; onChange: (language: InterviewLanguage) => void }) {
  const { t } = useTranslation();
  const name = useId();
  return (
    <div role="radiogroup" aria-label={t('interview.languageLabel')} className="filter-chips">
      {LANGUAGES.map((l) => (
        <label key={l} className={value === l ? 'chip active' : 'chip'}>
          <input type="radio" name={name} value={l} checked={value === l} disabled={disabled} onChange={() => onChange(l)} />
          {t(`interview.language.${l}`)}
        </label>
      ))}
    </div>
  );
}

/**
 * Replaces the set of questions: "New questions" and a change of language are the same action (spec 5.1). It warns first, and
 * the server writes only after the AI has finished, so cancelling or a failure leaves the current set as it is.
 */
export function NewQuestions({ applicationId, proposal, labelKey, onView, onActiveChange }: {
  applicationId: string;
  /** The language chosen when the warning opens. */
  proposal: InterviewLanguage;
  labelKey: string;
  onView: (view: InterviewPrepView) => void;
  /** The warning is open or the AI is working: other ways to change the set should wait. */
  onActiveChange?: (active: boolean) => void;
}) {
  const { t } = useTranslation();
  const [asking, setAsking] = useState(false);
  const [working, setWorking] = useState(false);
  const [language, setLanguage] = useState(proposal);
  const [error, setError] = useState<unknown>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => { onActiveChange?.(asking || working); }, [asking, working, onActiveChange]);

  const replace = async () => {
    const c = new AbortController();
    controller.current = c;
    setAsking(false);
    setWorking(true);
    setError(null);
    try {
      onView(await api.startInterview(applicationId, language, true, c.signal));
    } catch (err) {
      if (!c.signal.aborted) setError(err);
    } finally {
      if (controller.current === c) controller.current = null;
      setWorking(false);
    }
  };

  return (
    <div className="new-questions">
      {error ? <ErrorBanner error={error} /> : null}
      {working ? <ClaudeWorking textKey="interview.creating" onCancel={() => controller.current?.abort()} /> : null}
      {asking ? (
        <div className="card notice" role="alertdialog" aria-label={t(labelKey)}>
          <p>{t('interview.newQuestions.warning')}</p>
          <LanguageChoice value={language} onChange={setLanguage} />
          <div className="btn-row">
            <button type="button" className="btn" onClick={() => void replace()}>{t('interview.newQuestions.yes')}</button>
            <button type="button" className="btn ghost" onClick={() => setAsking(false)}>{t('common.cancel')}</button>
          </div>
        </div>
      ) : null}
      {asking || working ? null : (
        <button type="button" className="btn ghost" onClick={() => { setLanguage(proposal); setError(null); setAsking(true); }}>{t(labelKey)}</button>
      )}
    </div>
  );
}
