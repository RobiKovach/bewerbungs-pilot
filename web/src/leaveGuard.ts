import i18n from 'i18next';

/**
 * One place that knows "something on screen has unsaved changes" (fed by the app-wide UnsavedProvider) and asks
 * before that work is thrown away: another page (menu, any link, the browser's Back), another language, Quit,
 * or closing the tab.
 */
let unsaved = false;
let lastHash = '';

export function setUnsaved(value: boolean): void {
  unsaved = value;
}

/** True when it is fine to leave: nothing unsaved, or the person agreed to drop it. */
export function confirmLeave(): boolean {
  return !unsaved || window.confirm(i18n.t('unsaved.leave'));
}

/**
 * Must run before the app renders: the hashchange listener has to be the first one, so a "stay" can stop the
 * event before App/ApplicationsPage switch the page (and put the old address back).
 */
export function installLeaveGuard(): () => void {
  lastHash = window.location.hash;
  const onHash = (e: HashChangeEvent) => {
    if (window.location.hash === lastHash) return;
    if (!confirmLeave()) {
      e.stopImmediatePropagation();
      window.history.replaceState(null, '', lastHash || window.location.pathname);
      return;
    }
    lastHash = window.location.hash;
  };
  const onUnload = (e: BeforeUnloadEvent) => {
    if (!unsaved) return;
    e.preventDefault();
    e.returnValue = ''; // older browsers only show their own "Leave site?" when returnValue is set
  };
  window.addEventListener('hashchange', onHash);
  window.addEventListener('beforeunload', onUnload);
  return () => {
    window.removeEventListener('hashchange', onHash);
    window.removeEventListener('beforeunload', onUnload);
  };
}
