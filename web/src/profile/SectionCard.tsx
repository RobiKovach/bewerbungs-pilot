import { useState, type ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { ErrorBanner } from '../components/ErrorBanner';
import { InfoTip } from '../components/InfoTip';
import type { Section, SectionDataMap, SectionId } from '../types';
import { SECTION_FORMS, type FormProps } from './forms';
import { useProfile } from './ProfileContext';
import { sectionIsValid } from './validate';

export function SectionStatus({ section }: { section: Section<unknown> }) {
  const { t } = useTranslation();
  if (section.confirmedAt) return <span className="badge ok-badge">✓ {t('profile.status.confirmed')}</span>;
  if (section.aiFields.length > 0) return <span className="badge warn-badge">{t('profile.status.needsCheck')}</span>;
  return <span className="badge">{t('profile.status.notConfirmed')}</span>;
}

export function SectionCard({ id, showHeader = true }: { id: SectionId; showHeader?: boolean }) {
  const { t } = useTranslation();
  const { view } = useProfile();
  const [error, setError] = useState<unknown>(null);
  const section = view.profile.sections[id] as Section<unknown>;
  return (
    <div className="card section-card">
      {showHeader ? (
        <div className="section-head"><h2>{t(`profile.sections.${id}.title`)}</h2><SectionStatus section={section} /></div>
      ) : null}
      <p className="muted">{t(`profile.sections.${id}.hint`)}</p>
      {/* Remounts when the saved data changes, so the form always starts from what the server has. */}
      <SectionEditor key={JSON.stringify(section.data)} id={id} onError={setError} />
      {error ? <ErrorBanner error={error} /> : null}
    </div>
  );
}

function SectionEditor({ id, onError }: { id: SectionId; onError: (err: unknown) => void }) {
  const { t } = useTranslation();
  const { view, apply } = useProfile();
  const section = view.profile.sections[id] as Section<SectionDataMap[SectionId]>;
  const [draft, setDraft] = useState(section.data);
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(section.data);
  const valid = sectionIsValid(id, draft);
  const Form = SECTION_FORMS[id] as ComponentType<FormProps<SectionId>>;

  const act = async (confirm: boolean) => {
    setBusy(true);
    onError(null);
    try {
      if (dirty) apply(await api.saveSection(id, draft));
      if (confirm) apply(await api.confirmSection(id));
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Form data={draft} onChange={setDraft} isAi={(path) => section.aiFields.includes(path)} />
      {!valid ? <p className="field-error">{t('profile.fixDates')}</p> : null}
      <div className="btn-row">
        <button type="button" className="btn ghost" disabled={!dirty || !valid || busy} onClick={() => void act(false)}>{t('profile.save')}</button>
        <button type="button" className="btn" disabled={!valid || busy} onClick={() => void act(true)}>{t('profile.allCorrect')}</button>
        <InfoTip textKey="info.profileConfirm" />
      </div>
    </>
  );
}
