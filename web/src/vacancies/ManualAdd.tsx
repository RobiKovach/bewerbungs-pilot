import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../api';
import { ErrorBanner } from '../components/ErrorBanner';
import { ClaudeWorking } from '../profile/ClaudeWorking';
import { useCancellable } from '../profile/useCancellable';
import type { Vacancy, VacancyStatus } from '../types';
import { useVacancies } from './VacanciesContext';

// Character class kept identical to the server's jobdetailRefnr (server/src/vacancies/sources/arbeitsagentur.ts) —
// real Referenznummer values also contain `_`, `.` and `:` (e.g. "13635-js_bc_85_JB5198077-S", "15054-0001250:01-S").
export const AA_LINK = /^https:\/\/www\.arbeitsagentur\.de\/jobsuche\/jobdetail\/[A-Za-z0-9_.:-]{5,40}\/?([?#].*)?$/;
const MIN = 200;
const MAX = 30_000;

export function ManualAdd({ onClose, onAdded, onShow }: { onClose: () => void; onAdded: (v: Vacancy) => void; onShow: (v: { id: string; status: VacancyStatus }) => void }) {
  const { t } = useTranslation();
  const { vacancies, put } = useVacancies();
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const call = useCancellable();
  const trimmed = text.trim();
  const aaLink = AA_LINK.test(url.trim());
  const canAdd = (trimmed.length >= MIN || aaLink) && call.state.kind !== 'running';

  const add = async () => {
    const input = { ...(trimmed ? { text: trimmed } : {}), ...(url.trim() ? { url: url.trim() } : {}) };
    const res = await call.run((signal) => api.addManualVacancy(input, signal));
    if (!res) return;
    put(res.vacancy);
    onAdded(res.vacancy);
  };

  const error = call.state.kind === 'failed' ? call.state.error : null;
  const duplicateId = error instanceof ApiError && error.code === 'VACANCY_DUPLICATE' ? String(error.params?.id ?? '') : '';
  const duplicate = duplicateId ? vacancies.find((v) => v.id === duplicateId) : undefined;

  return (
    <section className="card manual-add" aria-labelledby="manual-add-title">
      <h2 id="manual-add-title">{t('vacancies.manual.title')}</h2>
      <p className="muted">{t('vacancies.manual.intro')}</p>
      <label className="field">
        <span>{t('vacancies.manual.text')}</span>
        <textarea rows={10} maxLength={MAX} value={text} onChange={(e) => setText(e.target.value)} disabled={call.state.kind === 'running'} />
      </label>
      <p className="muted">{t('vacancies.manual.counter', { count: trimmed.length, min: MIN })}</p>
      <label className="field">
        <span>{t('vacancies.manual.link')}</span>
        <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} disabled={call.state.kind === 'running'} />
      </label>
      <p className="muted">{t('vacancies.manual.linkHint')}</p>
      {call.state.kind === 'running' ? <ClaudeWorking textKey="vacancies.manual.working" onCancel={call.cancel} /> : (
        <div className="btn-row">
          <button type="button" className="btn" disabled={!canAdd} onClick={() => void add()}>{t('vacancies.manual.add')}</button>
          <button type="button" className="btn ghost" onClick={onClose}>{t('common.cancel')}</button>
        </div>
      )}
      {duplicateId ? (
        <div className="notice" role="status">
          <p>{t('vacancies.manual.duplicate')}</p>
          {duplicate ? <button type="button" className="btn small" onClick={() => onShow(duplicate)}>{t('vacancies.manual.showIt')}</button> : null}
        </div>
      ) : error ? <ErrorBanner error={error} /> : null}
    </section>
  );
}
