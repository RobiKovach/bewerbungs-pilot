import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import type { CvResult, Section, SectionId } from '../types';
import { MAX_DOCUMENTS, SECTION_IDS } from './constants';
import { CvProposalsBanner, proposalOf, sectionAnchor } from './CvProposal';
import { CvUpload } from './CvUpload';
import { useProfile } from './ProfileContext';
import { ReadinessBanner } from './ReadinessBanner';
import { SectionCard, SectionStatus } from './SectionCard';
import { FilesStep } from './steps/FilesStep';
import { StoriesStep } from './steps/StoriesStep';

type Panel = SectionId | 'stories' | 'files';

export function ProfileOverview() {
  const { t } = useTranslation();
  const { view } = useProfile();
  const { profile, readiness } = view;
  const [open, setOpen] = useState<Panel | null>(null);
  const [cvResult, setCvResult] = useState<Pick<CvResult, 'changedSections' | 'proposedSections'> | null>(null);
  const toggle = (panel: Panel) => setOpen(open === panel ? null : panel);
  const toggleButton = (panel: Panel, closedKey: string) => (
    <button type="button" className="btn ghost small" aria-expanded={open === panel} onClick={() => toggle(panel)}>
      {open === panel ? t('profile.close') : t(closedKey)}
    </button>
  );

  return (
    <section>
      <h1>{t('profile.title')}</h1>
      <ReadinessBanner readiness={readiness} />
      <CvProposalsBanner onOpen={setOpen} />

      <div className="card">
        <h2>{t('profile.cv.title')}</h2>
        {profile.cv
          ? <p><a href={api.fileUrl(profile.cv.id)} target="_blank" rel="noopener noreferrer">{t('profile.cv.current', { name: profile.cv.originalName })}</a></p>
          : <p className="muted">{t('profile.cv.none')}</p>}
        <p className="muted">{t('profile.cv.replaceHint')}</p>
        <CvUpload replace={profile.cv !== null} onDone={setCvResult} />
        {cvResult ? <CvResultNotice {...cvResult} /> : null}
      </div>

      {SECTION_IDS.map((id) => (
        <div key={id} id={sectionAnchor(id)} className="card">
          <div className="section-head">
            <h2>{t(`profile.sections.${id}.title`)}</h2>
            <SectionStatus section={profile.sections[id] as Section<unknown>} />
            {proposalOf(profile, id) !== undefined ? <span className="badge warn-badge">{t('profile.proposal.badge')}</span> : null}
            {toggleButton(id, 'profile.edit')}
          </div>
          {open === id ? <SectionCard id={id} showHeader={false} /> : null}
        </div>
      ))}

      <div className="card">
        <div className="section-head">
          <h2>{t('profile.storiesTitle')}</h2>
          <span className="badge">{t('profile.storiesCount', { count: profile.stories.filter((s) => s.confirmed).length })}</span>
          {toggleButton('stories', 'profile.addStories')}
        </div>
        {open === 'stories' ? <StoriesStep onNext={() => setOpen(null)} nextLabelKey="profile.close" /> : null}
      </div>

      <div className="card">
        <div className="section-head">
          <h2>{t('profile.files.title')}</h2>
          <span className="badge">{t('profile.files.docCount', { count: profile.documents.length, max: MAX_DOCUMENTS })}</span>
          {toggleButton('files', 'profile.edit')}
        </div>
        {open === 'files' ? <FilesStep onNext={() => setOpen(null)} nextLabelKey="profile.close" /> : null}
      </div>
    </section>
  );
}

/** What the last CV upload did: sections replaced (check again) and sections where the person has to choose. */
function CvResultNotice({ changedSections, proposedSections }: Pick<CvResult, 'changedSections' | 'proposedSections'>) {
  const { t } = useTranslation();
  const names = (ids: SectionId[]) => ids.map((id) => t(`profile.sections.${id}.title`)).join(', ');
  return (
    <div className="notice">
      {changedSections.length > 0 ? <p>{t('profile.cv.changed', { sections: names(changedSections) })}</p> : null}
      {proposedSections.length > 0 ? <p>{t('profile.cv.proposed', { sections: names(proposedSections) })}</p> : null}
      {changedSections.length === 0 && proposedSections.length === 0 ? <p>{t('profile.cv.unchanged')}</p> : null}
    </div>
  );
}
