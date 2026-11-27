import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useProfile } from '../profile/ProfileContext';
import type { NachweisSetup } from '../types';
import { NachweisSetupForm } from './NachweisSetupForm';

const germanDate = (iso: string) => (iso ? iso.split('-').reverse().join('.') : '');

/** One line per header value, as the form will print it. */
export function NachweisSummary({ setup }: { setup: NachweisSetup }) {
  const { t } = useTranslation();
  const lines: [string, string][] = [[t('nachweis.field.personName'), setup.personName]];
  if (setup.measure) {
    const m = setup.measure;
    lines.push([t('nachweis.field.provider'), m.provider], [t('nachweis.field.measureName'), m.name],
      [t('nachweis.summary.period'), [germanDate(m.entry), germanDate(m.exit)].filter(Boolean).join(' – ')], [t('nachweis.field.measureAdvisor'), m.advisor]);
  }
  if (setup.office) {
    const o = setup.office;
    lines.push([t('nachweis.field.office'), o.name], [t('nachweis.field.customerNumber'), o.customerNumber], [t('nachweis.field.officeAdvisor'), o.advisor]);
  }
  return (
    <dl className="nachweis-summary">
      <dt>{t('nachweis.audience.legend')}</dt><dd>{t(`nachweis.audience.${setup.audience}`)}</dd>
      {lines.filter(([, v]) => v.trim()).map(([k, v]) => <div key={k} className="nachweis-summary-row"><dt>{k}</dt><dd>{v}</dd></div>)}
      <dt>{t('nachweis.blank.legend')}</dt>
      <dd>{setup.blank.kind === 'own' ? t('nachweis.blank.recognised', { name: setup.blank.file.originalName }) : t('nachweis.blank.standard')}</dd>
    </dl>
  );
}

/** Profile card "Bewerbungsnachweis" (spec 0.15.0, 9.1): not in the wizard, not part of readiness. */
export function NachweisSection({ disabled = false }: { disabled?: boolean }) {
  const { t } = useTranslation();
  const { view, apply } = useProfile();
  const setup = view.profile.nachweis;
  const [editing, setEditing] = useState(false);
  return (
    <div className="card" id="profile-nachweis">
      <div className="section-head">
        <h2>{t('nachweis.title')}</h2>
        <span className={setup ? 'badge ok-badge' : 'badge'}>{setup ? t('nachweis.setUp') : t('nachweis.notSetUp')}</span>
        {!editing ? <button type="button" className="btn ghost small" disabled={disabled} onClick={() => setEditing(true)}>{setup ? t('profile.edit') : t('nachweis.setUpNow')}</button> : null}
      </div>
      <p className="muted">{t('nachweis.intro')}</p>
      {editing
        ? <NachweisSetupForm initial={setup} personName={view.profile.sections.personal.data.fullName} onApply={apply}
          onSaved={(v) => { apply(v); setEditing(false); }} onCancel={() => setEditing(false)} />
        : setup ? <NachweisSummary setup={setup} /> : null}
    </div>
  );
}
