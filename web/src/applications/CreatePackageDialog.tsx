import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../api';
import { ErrorBanner } from '../components/ErrorBanner';
import { ClaudeWorking } from '../profile/ClaudeWorking';
import type { DocLanguage, NewPackageInfo, PackageReadiness, Vacancy } from '../types';
import { jobError, useApplicationJob } from './useApplicationJob';

const LANGUAGES: DocLanguage[] = ['de', 'en'];

/** What is still missing in the profile, with a link to it. */
export function MissingList({ readiness, id }: { readiness: PackageReadiness; id?: string }) {
  const { t } = useTranslation();
  return (
    <div role="status" id={id}>
      <p>{t('applications.create.notReady')}</p>
      <ul>
        {readiness.missingSections.map((id) => <li key={id}>{t(`profile.sections.${id}.title`)}</li>)}
        {readiness.noStory ? <li>{t('applications.create.noStory')}</li> : null}
      </ul>
      <a className="btn" href="#/profile">{t('applications.create.toProfile')}</a>
    </div>
  );
}

export function CreatePackageDialog({ vacancy, onClose, pollMs }: { vacancy: Vacancy; onClose: () => void; pollMs?: number }) {
  const { t } = useTranslation();
  const [info, setInfo] = useState<NewPackageInfo | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [language, setLanguage] = useState<DocLanguage>('de');
  const job = useApplicationJob({
    pollMs,
    onFinished: (s) => {
      if (s.state === 'done' && s.kind === 'create' && s.vacancyId === vacancy.id && s.applicationId) window.location.hash = `#/applications/${s.applicationId}`;
    },
  });

  useEffect(() => {
    let alive = true;
    api.newPackageInfo(vacancy.id).then((i) => { if (!alive) return; setInfo(i); setLanguage(i.suggestedLanguage); }, (err) => { if (alive) setLoadError(err); });
    return () => { alive = false; };
  }, [vacancy.id]);

  const mine = job.state?.kind === 'create' && job.state.vacancyId === vacancy.id;
  const running = job.state?.state === 'running';
  const failed = mine ? jobError(job.state) : null;
  const raced = job.error instanceof ApiError && job.error.code === 'PACKAGE_EXISTS' ? String(job.error.params?.id ?? '') : '';
  const title = t('applications.create.title');

  let body;
  if (loadError) body = <ErrorBanner error={loadError} />;
  else if (!info) body = <p className="muted">{t('common.loading')}</p>;
  else if (info.existingId || raced) {
    const id = info.existingId ?? raced;
    body = <p>{t('applications.create.exists')} <a href={`#/applications/${id}`}>{t('applications.open')}</a></p>;
  } else if (!info.readiness.ready) {
    body = <MissingList readiness={info.readiness} />;
  } else {
    body = (
      <>
        <fieldset className="create-package__languages" disabled={running}>
          <legend>{t('applications.create.language')}</legend>
          {LANGUAGES.map((l) => (
            <label key={l}><input type="radio" name={`lang-${vacancy.id}`} checked={language === l} onChange={() => setLanguage(l)} /> {t(`applications.language.${l}`)}</label>
          ))}
        </fieldset>
        {language === 'en' && info.englishBelowB2 ? <p className="notice">{t('applications.create.englishWarning')}</p> : null}
        {info.shortText ? <p className="notice">{t('applications.create.shortText')}</p> : null}
        {running ? (
          mine ? <ClaudeWorking textKey="applications.create.working" onCancel={() => void job.cancel()} /> : <p className="muted">{t('applications.busy')}</p>
        ) : (
          <div className="btn-row">
            <button type="button" className="btn" onClick={() => void job.start(() => api.createPackage(vacancy.id, language))}>{t('applications.create.start')}</button>
            <button type="button" className="btn ghost" onClick={onClose}>{t('common.cancel')}</button>
          </div>
        )}
        {job.error ? <ErrorBanner error={job.error} /> : null}
        {failed ? <ErrorBanner error={failed} /> : null}
      </>
    );
  }
  return (
    <section className="card create-package" role="region" aria-label={title}>
      <h3>{title}</h3>
      {body}
    </section>
  );
}
