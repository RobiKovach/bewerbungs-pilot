import { useEffect, useState, type ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { ErrorBanner } from '../components/ErrorBanner';
import { InfoTip } from '../components/InfoTip';
import type { Section, SectionDataMap, SectionId } from '../types';
import { CvProposalBox } from './CvProposal';
import { SECTION_FORMS, type FormProps } from './forms';
import { useProfile } from './ProfileContext';
import { useReportUnsaved } from './unsaved';
import { sectionProblem } from './validate';

export function SectionStatus({ section }: { section: Section<unknown> }) {
  const { t } = useTranslation();
  if (section.confirmedAt) return <span className="badge ok-badge">✓ {t('profile.status.confirmed')}</span>;
  if (section.aiFields.length > 0) return <span className="badge warn-badge">{t('profile.status.needsCheck')}</span>;
  return <span className="badge">{t('profile.status.notConfirmed')}</span>;
}

/** `readOnly`: shown but not editable while Claude reads a new CV that may replace this section (overview). */
export function SectionCard({ id, showHeader = true, readOnly = false }: { id: SectionId; showHeader?: boolean; readOnly?: boolean }) {
  const { t } = useTranslation();
  const { view } = useProfile();
  const [error, setError] = useState<unknown>(null);
  const [hasUnsaved, setHasUnsaved] = useState(false);
  const section = view.profile.sections[id] as Section<unknown>;
  return (
    <div className="card section-card">
      {showHeader ? (
        <div className="section-head"><h2>{t(`profile.sections.${id}.title`)}</h2><SectionStatus section={section} /></div>
      ) : null}
      <p className="muted">{t(`profile.sections.${id}.hint`)}</p>
      {readOnly ? <p className="notice">{t('profile.cv.reading')}</p> : null}
      {/* A disabled fieldset disables every input and button inside, so no draft can start. */}
      <fieldset className="plain-fieldset" disabled={readOnly}>
        <CvProposalBox id={id} hasUnsaved={hasUnsaved} />
        {/* Remounts when the saved data changes, so the form always starts from what the server has. */}
        <SectionEditor key={JSON.stringify(section.data)} id={id} onError={setError} onDirtyChange={setHasUnsaved} />
      </fieldset>
      {error ? <ErrorBanner error={error} /> : null}
    </div>
  );
}

/** What is sent on save: link labels/addresses trimmed, link rows with both fields empty dropped. */
function cleaned(id: SectionId, data: SectionDataMap[SectionId]): SectionDataMap[SectionId] {
  if (id !== 'personal') return data;
  const d = data as SectionDataMap['personal'];
  const links = d.links.map((l) => ({ label: l.label.trim(), url: l.url.trim() })).filter((l) => l.label !== '' || l.url !== '');
  return { ...d, links };
}

interface EditorProps { id: SectionId; onError: (err: unknown) => void; onDirtyChange: (dirty: boolean) => void }

function SectionEditor({ id, onError, onDirtyChange }: EditorProps) {
  const { t } = useTranslation();
  const { view, apply } = useProfile();
  const section = view.profile.sections[id] as Section<SectionDataMap[SectionId]>;
  const [draft, setDraft] = useState(section.data);
  const [busy, setBusy] = useState(false);
  // Bumped by "Discard changes": remounts the form, so fields that keep their own text (LinesField) start fresh.
  const [formKey, setFormKey] = useState(0);
  const dirty = JSON.stringify(draft) !== JSON.stringify(section.data);
  const problem = sectionProblem(id, draft);
  const valid = problem === null;
  const Form = SECTION_FORMS[id] as ComponentType<FormProps<SectionId>>;
  useReportUnsaved(dirty);
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);
  const discard = () => { setDraft(section.data); setFormKey((k) => k + 1); };

  const act = async (confirm: boolean) => {
    setBusy(true);
    onError(null);
    try {
      if (dirty) {
        const toSave = cleaned(id, draft);
        apply(await api.saveSection(id, toSave));
        setDraft(toSave);
      }
      if (confirm) apply(await api.confirmSection(id));
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Form key={formKey} data={draft} onChange={setDraft} isAi={(path) => section.aiFields.includes(path)} />
      {problem ? <p className="field-error">{t(problem)}</p> : null}
      <div className="btn-row">
        <button type="button" className="btn ghost" disabled={!dirty || !valid || busy} onClick={() => void act(false)}>{t('profile.save')}</button>
        <button type="button" className="btn" disabled={!valid || busy} onClick={() => void act(true)}>{t('profile.allCorrect')}</button>
        {dirty ? <button type="button" className="btn ghost" disabled={busy} onClick={discard}>{t('profile.discard')}</button> : null}
        <InfoTip textKey="info.profileConfirm" />
      </div>
    </>
  );
}
