import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { api } from '../api';
import { ErrorBanner } from '../components/ErrorBanner';
import type { CvSectionId, PersonalData, Profile, SectionDataMap, SectionId } from '../types';
import { CV_SECTION_IDS } from './constants';
import { useProfile } from './ProfileContext';

/** What a newly uploaded CV says for a section the person had already checked or edited (undefined = nothing to decide). */
export function proposalOf(profile: Profile, id: SectionId): unknown {
  return (profile.cvProposals as Partial<Record<SectionId, unknown>>)[id];
}

const sectionsWithProposal = (profile: Profile): CvSectionId[] => CV_SECTION_IDS.filter((id) => proposalOf(profile, id) !== undefined);

/** The overview's card and the wizard's section wrapper carry this id, so the banner can take the person there. */
export const sectionAnchor = (id: SectionId) => `profile-section-${id}`;

/**
 * Lists the sections where a new CV has a different version the person has to choose about. `onOpen` shows that
 * section (the overview opens its panel first); the page then scrolls to it.
 */
export function CvProposalsBanner({ onOpen }: { onOpen?: (id: CvSectionId) => void }) {
  const { t } = useTranslation();
  const { view } = useProfile();
  const ids = sectionsWithProposal(view.profile);
  if (ids.length === 0) return null;
  const open = (id: CvSectionId) => {
    onOpen?.(id);
    document.getElementById(sectionAnchor(id))?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  };
  return (
    <div className="card proposals-banner">
      <p><strong>{t('profile.proposal.bannerTitle')}</strong></p>
      <ul>
        {ids.map((id) => (
          <li key={id}><button type="button" className="link-btn" onClick={() => open(id)}>{t(`profile.sections.${id}.title`)}</button></li>
        ))}
      </ul>
    </div>
  );
}

interface Row { label: string; value: string; differs: boolean }
interface Entry { rows: Row[]; differs: boolean }

const PERSONAL_FIELDS = [
  'fullName', 'email', 'phone', 'street', 'postalCode', 'city', 'country', 'birthDate', 'nationality', 'workPermit', 'drivingLicense',
] as const satisfies readonly (keyof PersonalData)[];

/** The section as label/value pairs, with the same labels as the form. Personal details are one entry. */
function toEntries(id: CvSectionId, data: unknown, t: TFunction): { label: string; value: string }[][] {
  const row = (labelKey: string, value: string) => ({ label: t(labelKey), value });
  switch (id) {
    case 'personal': {
      const d = data as PersonalData;
      return [PERSONAL_FIELDS.map((k) => row(`profile.personal.${k}`, d[k]))];
    }
    case 'education':
      return (data as SectionDataMap['education']).items.map((e) => [
        row('profile.entry.kind', t(`profile.educationKind.${e.kind}`)), row('profile.entry.degree', e.degree),
        row('profile.entry.institution', e.institution), row('profile.entry.city', e.city), row('profile.entry.country', e.country),
        row('profile.entry.from', e.from), row('profile.entry.to', e.to), row('profile.entry.description', e.description),
      ]);
    case 'experience':
      return (data as SectionDataMap['experience']).items.map((e) => [
        row('profile.entry.jobTitle', e.jobTitle), row('profile.entry.employer', e.employer), row('profile.entry.city', e.city),
        row('profile.entry.country', e.country), row('profile.entry.from', e.from), row('profile.entry.to', e.to),
        row('profile.entry.description', e.description),
      ]);
    case 'skills':
      return (data as SectionDataMap['skills']).items.map((s) => [
        row('profile.entry.skill', s.name), row('profile.entry.level', s.level ? t(`profile.skillLevel.${s.level}`) : ''),
      ]);
    case 'languages':
      return (data as SectionDataMap['languages']).items.map((l) => [
        row('profile.entry.language', l.language), row('profile.entry.level', l.level ? t(`profile.languageLevel.${l.level}`) : ''),
        row('profile.entry.certificate', l.certificate),
      ]);
  }
}

/**
 * Both versions without empty values. Differences are marked: per field for personal details, per entry for lists
 * (an entry differs when the other version has no entry with the same content).
 */
function compare(id: CvSectionId, now: unknown, next: unknown, t: TFunction): { now: Entry[]; next: Entry[] } {
  const a = toEntries(id, now, t);
  const b = toEntries(id, next, t);
  const filled = <R extends { value: string }>(rows: R[]) => rows.filter((r) => r.value.trim() !== '');
  if (id === 'personal') {
    const side = (mine: typeof a[number], other: typeof a[number]): Entry[] => {
      const rows = filled(mine.map((r, i) => ({ ...r, differs: r.value !== other[i].value })));
      return rows.length ? [{ rows, differs: false }] : [];
    };
    return { now: side(a[0], b[0]), next: side(b[0], a[0]) };
  }
  const sig = (rows: { value: string }[]) => JSON.stringify(rows.map((r) => r.value));
  const side = (mine: typeof a, other: typeof a): Entry[] => {
    const others = new Set(other.map(sig));
    return mine.map((rows) => ({ rows: filled(rows).map((r) => ({ ...r, differs: false })), differs: !others.has(sig(rows)) }));
  };
  return { now: side(a, b), next: side(b, a) };
}

function Version({ title, entries }: { title: string; entries: Entry[] }) {
  const { t } = useTranslation();
  const differs = <span className="badge warn-badge">{t('profile.proposal.differs')}</span>;
  return (
    <section className="proposal-side" aria-label={title}>
      <h3>{title}</h3>
      {entries.length === 0 ? <p className="muted">{t('profile.proposal.empty')}</p> : entries.map((e, i) => (
        <div key={i} className={e.differs ? 'proposal-entry differs' : 'proposal-entry'}>
          {e.differs ? differs : null}
          <dl>
            {e.rows.map((r) => (
              <div key={r.label} className={r.differs ? 'differs' : undefined}>
                <dt>{r.label}</dt>
                <dd>{r.value}{r.differs ? <> {differs}</> : null}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </section>
  );
}

/**
 * Shown above a section's form while a new CV has a different version of it. Nothing changes until the person
 * chooses. "Take the new version" is held back while the form below has unsaved changes (they would be lost).
 */
export function CvProposalBox({ id, hasUnsaved }: { id: SectionId; hasUnsaved: boolean }) {
  const { t } = useTranslation();
  const { view, apply } = useProfile();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const proposal = proposalOf(view.profile, id);
  if (proposal === undefined || id === 'wishes') return null;
  const versions = compare(id, view.profile.sections[id].data, proposal, t);

  const choose = async (take: boolean) => {
    setBusy(true);
    setError(null);
    try {
      apply(await (take ? api.acceptProposal(id) : api.rejectProposal(id)));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="proposal">
      <h3>{t('profile.proposal.title')}</h3>
      <p className="muted">{t('profile.proposal.intro')}</p>
      <div className="proposal-compare">
        <Version title={t('profile.proposal.now')} entries={versions.now} />
        <Version title={t('profile.proposal.new')} entries={versions.next} />
      </div>
      {hasUnsaved ? <p className="notice">{t('profile.proposal.saveFirst')}</p> : null}
      <div className="btn-row">
        <button type="button" className="btn" disabled={busy || hasUnsaved} onClick={() => void choose(true)}>{t('profile.proposal.take')}</button>
        <button type="button" className="btn ghost" disabled={busy} onClick={() => void choose(false)}>{t('profile.proposal.keep')}</button>
      </div>
      {error ? <ErrorBanner error={error} /> : null}
    </div>
  );
}
