import type { Language } from '@bp/shared';

type Outcome = 'ready' | 'cancelled' | 'failed' | 'unknown';

/** Fixed texts only: nothing from the request, the code or the account ever reaches this page. */
const TEXTS: Record<Language, Record<Outcome, [string, string]>> = {
  en: {
    ready: ['You are signed in', 'You can close this tab and go back to BewerbungsPilot.'],
    cancelled: ['Sign-in was cancelled', 'Go back to BewerbungsPilot and try again.'],
    failed: ['Sign-in did not work', 'Go back to BewerbungsPilot — it shows what to do.'],
    unknown: ['This sign-in link is no longer valid', 'Start the sign-in again in BewerbungsPilot.'],
  },
  de: {
    ready: ['Sie sind angemeldet', 'Sie können diesen Tab schließen und zu BewerbungsPilot zurückgehen.'],
    cancelled: ['Die Anmeldung wurde abgebrochen', 'Gehen Sie zurück zu BewerbungsPilot und versuchen Sie es noch einmal.'],
    failed: ['Die Anmeldung hat nicht geklappt', 'Gehen Sie zurück zu BewerbungsPilot — dort steht, was zu tun ist.'],
    unknown: ['Dieser Anmelde-Link ist nicht mehr gültig', 'Starten Sie die Anmeldung in BewerbungsPilot noch einmal.'],
  },
  uk: {
    ready: ['Ви увійшли', 'Можете закрити цю вкладку й повернутися до BewerbungsPilot.'],
    cancelled: ['Вхід скасовано', 'Поверніться до BewerbungsPilot і спробуйте ще раз.'],
    failed: ['Вхід не вдався', 'Поверніться до BewerbungsPilot — там написано, що робити.'],
    unknown: ['Це посилання для входу вже недійсне', 'Почніть вхід заново в BewerbungsPilot.'],
  },
  ru: {
    ready: ['Вы вошли', 'Можете закрыть эту вкладку и вернуться в BewerbungsPilot.'],
    cancelled: ['Вход отменён', 'Вернитесь в BewerbungsPilot и попробуйте ещё раз.'],
    failed: ['Войти не удалось', 'Вернитесь в BewerbungsPilot — там написано, что делать.'],
    unknown: ['Эта ссылка для входа больше не действует', 'Начните вход заново в BewerbungsPilot.'],
  },
  pl: {
    ready: ['Jesteś zalogowany(-a)', 'Możesz zamknąć tę kartę i wrócić do BewerbungsPilot.'],
    cancelled: ['Logowanie zostało anulowane', 'Wróć do BewerbungsPilot i spróbuj jeszcze raz.'],
    failed: ['Logowanie się nie powiodło', 'Wróć do BewerbungsPilot — tam jest napisane, co zrobić.'],
    unknown: ['Ten link do logowania jest już nieważny', 'Rozpocznij logowanie od nowa w BewerbungsPilot.'],
  },
  ro: {
    ready: ['Sunteți autentificat(ă)', 'Puteți închide această filă și reveni la BewerbungsPilot.'],
    cancelled: ['Autentificarea a fost anulată', 'Reveniți la BewerbungsPilot și încercați din nou.'],
    failed: ['Autentificarea nu a reușit', 'Reveniți la BewerbungsPilot — acolo scrie ce trebuie făcut.'],
    unknown: ['Acest link de autentificare nu mai este valabil', 'Porniți din nou autentificarea în BewerbungsPilot.'],
  },
};

/** The whole page shown in the browser tab Google sends the person back to. No script, no style, no dynamic content. */
export function callbackPage(language: Language, outcome: Outcome): string {
  const [title, text] = TEXTS[language][outcome];
  return `<!doctype html><html lang="${language}"><meta charset="utf-8"><title>BewerbungsPilot</title><h1>${title}</h1><p>${text}</p></html>`;
}
