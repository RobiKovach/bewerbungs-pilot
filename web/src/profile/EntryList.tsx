import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

export function EntryList<T extends { id: string }>({ items, onChange, create, addLabel, render }: {
  items: T[];
  onChange: (items: T[]) => void;
  create: () => T;
  addLabel: string;
  render: (item: T, update: (patch: Partial<T>) => void) => ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="entry-list">
      {items.map((item) => (
        <div key={item.id} className="entry">
          {render(item, (patch) => onChange(items.map((x) => (x.id === item.id ? { ...x, ...patch } : x))))}
          <div className="btn-row">
            <button type="button" className="btn ghost small" onClick={() => onChange(items.filter((x) => x.id !== item.id))}>{t('profile.remove')}</button>
          </div>
        </div>
      ))}
      <button type="button" className="btn ghost" onClick={() => onChange([...items, create()])}>{addLabel}</button>
    </div>
  );
}
