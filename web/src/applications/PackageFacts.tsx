import { useTranslation } from 'react-i18next';

/**
 * "About the company" in the package editor (0.13.0, spec 3.4): the facts this letter was written with — the
 * package's snapshot, read-only (news and red flags stay on the vacancy card). When the card's facts differ now, a
 * note offers "Create again", which takes the current facts.
 */
export function PackageFacts({ facts, changed, busy, onRecreate }: {
  facts: string[];
  /** The card's non-hidden facts differ from the snapshot (never for a sent package). */
  changed: boolean;
  busy: boolean;
  onRecreate: () => void;
}) {
  const { t } = useTranslation();
  if (facts.length === 0 && !changed) return null;
  return (
    <>
      {changed ? (
        <div className="notice package-facts__changed" role="status">
          <p>{t('applications.companyFacts.changed')}</p>
          <div className="btn-row"><button type="button" className="btn small" disabled={busy} onClick={onRecreate}>{t('applications.recreate')}</button></div>
        </div>
      ) : null}
      {facts.length > 0 ? (
        <details className="card package-facts">
          <summary>{t('applications.companyFacts.title')}</summary>
          <p><strong>{t('applications.companyFacts.used')}</strong></p>
          <ul>{facts.map((f, i) => <li key={i}>{f}</li>)}</ul>
          <p className="muted">{t('applications.companyFacts.hint')}</p>
        </details>
      ) : null}
    </>
  );
}
