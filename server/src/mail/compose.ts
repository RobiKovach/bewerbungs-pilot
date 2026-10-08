import type { ApplicationPackage, DocLanguage, Language } from '@bp/shared';

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

const APPLICATION_BODY: Record<DocLanguage, (title: string) => string> = {
  de: (title) => `anbei sende ich Ihnen meine Bewerbung als ${title} mit Anschreiben und Lebenslauf. Ich freue mich auf Ihre Rückmeldung.`,
  en: (title) => `please find attached my application for the position of ${title}, with my cover letter and CV. I look forward to hearing from you.`,
};
const CLOSING: Record<DocLanguage, string> = { de: 'Mit freundlichen Grüßen', en: 'Kind regards' };

/** The suggested email to the employer; the person can edit it in the send dialog. */
export function applicationEmail(p: ApplicationPackage): { subject: string; text: string } {
  const lang = p.language;
  const { fullName, phone, email } = p.snapshot.personal;
  const signature = [fullName, phone, email].filter((l) => l !== '');
  const text = [p.letter.salutation, '', APPLICATION_BODY[lang](p.vacancy.title), '', CLOSING[lang], ...signature].join('\n');
  return { subject: p.letter.subject, text };
}
