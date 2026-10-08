import type { Language } from '@bp/shared';

const TEST_MAIL: Record<Language, { subject: string; text: string }> = {
  en: {
    subject: 'BewerbungsPilot: test email',
    text: 'This is a test email from BewerbungsPilot. Your email is connected — applications you approve can now be sent from the app.',
  },
  uk: {
    subject: 'BewerbungsPilot: тестовий лист',
    text: 'Це тестовий лист від BewerbungsPilot. Вашу пошту підключено — заявки, які ви схвалите, тепер можна надсилати просто з програми.',
  },
  de: {
    subject: 'BewerbungsPilot: Test-E-Mail',
    text: 'Dies ist eine Test-E-Mail von BewerbungsPilot. Ihre E-Mail ist verbunden — Bewerbungen, die Sie freigeben, können jetzt direkt aus der App verschickt werden.',
  },
  ru: {
    subject: 'BewerbungsPilot: тестовое письмо',
    text: 'Это тестовое письмо от BewerbungsPilot. Ваша почта подключена — заявки, которые вы одобрите, теперь можно отправлять прямо из приложения.',
  },
  pl: {
    subject: 'BewerbungsPilot: testowa wiadomość',
    text: 'To jest testowa wiadomość z BewerbungsPilot. Twoja poczta jest połączona — zatwierdzone przez Ciebie aplikacje można teraz wysyłać prosto z programu.',
  },
  ro: {
    subject: 'BewerbungsPilot: e-mail de test',
    text: 'Acesta este un e-mail de test de la BewerbungsPilot. Poșta dumneavoastră este conectată — candidaturile pe care le aprobați pot fi acum trimise direct din aplicație.',
  },
};

export function testMail(language: Language): { subject: string; text: string } {
  return TEST_MAIL[language];
}
