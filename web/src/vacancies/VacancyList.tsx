import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import type { Vacancy } from '../types';
import { forTab, tabCounts, TABS, type Tab } from './sort';
import { useVacancies } from './VacanciesContext';
import { VacancyCard } from './VacancyCard';

export function VacancyList({ tab, onTab, focusId = null, toastMs = 8000, renderExtra }: {
  tab: Tab; onTab: (t: Tab) => void; focusId?: string | null; toastMs?: number; renderExtra?: (v: Vacancy) => ReactNode;
}) {
  const { t } = useTranslation();
  const { vacancies, put } = useVacancies();
  const [toast, setToast] = useState<Vacancy | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const counts = tabCounts(vacancies);
  const { main, weak } = forTab(vacancies, tab);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => {
    if (focusId) document.getElementById(`vacancy-${focusId}`)?.scrollIntoView?.({ block: 'center' });
  }, [focusId, tab]);

  const onHidden = (v: Vacancy) => {
    if (timer.current) clearTimeout(timer.current);
    setToast(v);
    timer.current = setTimeout(() => setToast(null), toastMs);
  };
  const undo = async () => {
    if (!toast) return;
    const id = toast.id;
    setToast(null);
    put((await api.setVacancyStatus(id, 'new')).vacancy);
  };
  const cardOf = (v: Vacancy) => <VacancyCard key={v.id} vacancy={v} highlighted={v.id === focusId} onHidden={onHidden} extra={renderExtra?.(v)} />;

  return (
    <div className="vacancy-list">
      <div role="tablist" className="tabs">
        {TABS.map((id) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'tab active' : 'tab'} onClick={() => onTab(id)}>
            {t(`vacancies.tabs.${id}`)} <span className="badge">{counts[id]}</span>
          </button>
        ))}
      </div>
      {main.length === 0 && weak.length === 0 ? <p className="muted">{t(`vacancies.tabs.empty.${tab}`)}</p> : null}
      {main.map(cardOf)}
      {weak.length > 0 ? (
        <details className="weak-block">
          <summary>{t('vacancies.weak', { count: weak.length })}</summary>
          {weak.map(cardOf)}
        </details>
      ) : null}
      {toast ? (
        <div className="toast" role="status">
          {t('vacancies.toast.hidden')}{' '}
          <button type="button" className="btn small" onClick={() => void undo()}>{t('vacancies.toast.undo')}</button>
        </div>
      ) : null}
    </div>
  );
}
