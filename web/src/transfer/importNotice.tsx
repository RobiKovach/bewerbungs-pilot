import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { useOptionalSettings } from '../settings';

/**
 * What is left to do after a file was opened (spec 2026-11-04 transfer, section 6). Kept in this page's memory on purpose,
 * not in the settings and not in the browser storage: it is said once, it survives the change from the wizard to the home
 * page, and the next start of the app does not repeat it.
 */
let shown = false;
const listeners = new Set<() => void>();

function setShown(next: boolean) {
  shown = next;
  listeners.forEach((l) => l());
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function markImported(): void { setShown(true); }
export function dismissImportNotice(): void { setShown(false); }

export function ImportNotice() {
  const { t } = useTranslation();
  const visible = useSyncExternalStore(subscribe, () => shown);
  // During the welcome steps the menu and the pages are hidden: #/settings would show nothing new.
  const pages = useOptionalSettings()?.settings.onboarding.completed ?? true;
  if (!visible) return null;
  return (
    <aside className="notice notice-warn dismissible import-notice" role="status">
      <button type="button" className="notice-close" aria-label={t('common.dismiss')} title={t('common.dismiss')} onClick={dismissImportNotice}>×</button>
      <p><strong>{t('importNotice.title')}</strong></p>
      <ul>
        <li>
          {t('importNotice.ai')}
          {pages ? <> <a href="#/settings">{t('importNotice.settingsLink')}</a></> : null}
        </li>
        <li>{t('importNotice.mail')}</li>
        <li>{t('importNotice.noResend')}</li>
      </ul>
    </aside>
  );
}
