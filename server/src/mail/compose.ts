import type { ApplicationPackage, DocLanguage, Language } from '@bp/shared';
import { initiativeRole, isInitiative } from '../applications/initiative.js';

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

/**
 * The position for the email text. Some employers put their name in front of the job title on the job board
 * ("move elevator GmbH: TYPO3-Frontend-Developer"): "…Bewerbung als move elevator GmbH: …" reads wrong, so a leading
 * "<company>:" / "<company> -" / "<company> |" is left out. Anything else stays exactly as the ad says.
 */
export function positionTitle(p: ApplicationPackage): string {
  const { title, company } = p.vacancy;
  const name = company.trim();
  if (name === '' || !title.toLowerCase().startsWith(name.toLowerCase())) return title;
  const rest = /^\s*[:|–—-]\s*(\S.*)$/s.exec(title.slice(name.length));
  return rest ? rest[1]!.trim() : title;
}

const APPLICATION_BODY: Record<DocLanguage, (title: string) => string> = {
  de: (title) => `anbei sende ich Ihnen meine Bewerbung als ${title} mit Anschreiben und Lebenslauf. Ich freue mich auf Ihre Rückmeldung.`,
  en: (title) => `please find attached my application for the position of ${title}, with my cover letter and CV. I look forward to hearing from you.`,
};
/** Unsolicited applications (Task 10c): no advertised position; the role is the card title without its prefix. */
const INITIATIVE_APPLICATION_BODY: Record<DocLanguage, (role: string) => string> = {
  de: (role) => `anbei sende ich Ihnen meine Initiativbewerbung${role ? ` als ${role}` : ''} mit Anschreiben und Lebenslauf. Ich freue mich auf Ihre Rückmeldung.`,
  en: (role) => `please find attached my unsolicited application${role ? ` as ${role}` : ''}, with my cover letter and CV. I look forward to hearing from you.`,
};
const CLOSING: Record<DocLanguage, string> = { de: 'Mit freundlichen Grüßen', en: 'Kind regards' };

/** The suggested email to the employer; the person can edit it in the send dialog. */
export function applicationEmail(p: ApplicationPackage): { subject: string; text: string } {
  const lang = p.language;
  const { fullName, phone, email } = p.snapshot.personal;
  const signature = [fullName, phone, email].filter((l) => l !== '');
  const body = isInitiative(p.vacancy) ? INITIATIVE_APPLICATION_BODY[lang](initiativeRole(p.vacancy.title)) : APPLICATION_BODY[lang](positionTitle(p));
  const text = [p.letter.salutation, '', body, '', CLOSING[lang], ...signature].join('\n');
  return { subject: p.letter.subject, text };
}

const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** The day the application went out (first sent/submitted entry), local time; DE "05.10.2026", EN "5 October 2026". */
export function sentDay(p: ApplicationPackage): string {
  const entry = p.history.find((h) => h.kind === 'sent' || h.kind === 'submitted');
  const d = new Date(entry ? entry.at : p.updatedAt);
  if (p.language === 'en') return `${d.getDate()} ${MONTHS_EN[d.getMonth()]} ${d.getFullYear()}`;
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}

export function replySubject(p: ApplicationPackage): string {
  return `Re: ${p.sentEmail?.subject ?? p.letter.subject}`.slice(0, 200);
}

const FOLLOW_UP_BODY: Record<DocLanguage, (title: string, day: string) => string> = {
  de: (title, day) => `ich wollte mich nach dem Stand meiner Bewerbung als ${title} vom ${day} erkundigen. Ich bin weiterhin sehr an der Stelle interessiert und würde mich über eine kurze Rückmeldung freuen.`,
  en: (title, day) => `I would like to ask about the status of my application for the position of ${title}, sent on ${day}. I am still very interested in the position and would appreciate a short update.`,
};
const REJECTION_BODY: Record<DocLanguage, (title: string, company: string) => string> = {
  de: (title, company) => `vielen Dank für Ihre Rückmeldung und die Zeit, die Sie sich für meine Bewerbung als ${title} genommen haben. Auch wenn es diesmal nicht geklappt hat, bin ich weiterhin an ${company} interessiert und würde mich freuen, wenn Sie mich bei passenden Stellen berücksichtigen. Falls Sie mir kurz sagen können, was den Ausschlag gegeben hat, wäre ich Ihnen sehr dankbar.`,
  en: (title, company) => `thank you for your reply and for the time you spent on my application for the position of ${title}. Although it did not work out this time, I am still interested in ${company} and would be glad if you kept me in mind for suitable positions. If you could briefly tell me what made the difference, I would be very grateful.`,
};

const INITIATIVE_FOLLOW_UP_BODY: Record<DocLanguage, (role: string, day: string, company: string) => string> = {
  de: (role, day, company) => `ich wollte mich nach dem Stand meiner Initiativbewerbung${role ? ` als ${role}` : ''} vom ${day} erkundigen. Ich bin weiterhin sehr an einer Mitarbeit bei ${company} interessiert und würde mich über eine kurze Rückmeldung freuen.`,
  en: (role, day, company) => `I would like to ask about the status of my unsolicited application${role ? ` as ${role}` : ''}, sent on ${day}. I am still very interested in working at ${company} and would appreciate a short update.`,
};
const INITIATIVE_REJECTION_BODY: Record<DocLanguage, (role: string, company: string) => string> = {
  de: (role, company) => `vielen Dank für Ihre Rückmeldung und die Zeit, die Sie sich für meine Initiativbewerbung${role ? ` als ${role}` : ''} genommen haben. Auch wenn es diesmal nicht geklappt hat, bin ich weiterhin an ${company} interessiert und würde mich freuen, wenn Sie mich bei passenden Stellen berücksichtigen. Falls Sie mir kurz sagen können, was den Ausschlag gegeben hat, wäre ich Ihnen sehr dankbar.`,
  en: (role, company) => `thank you for your reply and for the time you spent on my unsolicited application${role ? ` as ${role}` : ''}. Although it did not work out this time, I am still interested in ${company} and would be glad if you kept me in mind for suitable positions. If you could briefly tell me what made the difference, I would be very grateful.`,
};

function replyLayout(p: ApplicationPackage, body: string): string {
  const { fullName, phone, email } = p.snapshot.personal;
  const signature = [fullName, phone, email].filter((l) => l !== '');
  return [p.letter.salutation, '', body, '', CLOSING[p.language], ...signature].join('\n');
}

/** The reminder ("write again"): same salutation as the application, no Claude. */
export function followUpEmail(p: ApplicationPackage): { subject: string; text: string } {
  const body = isInitiative(p.vacancy)
    ? INITIATIVE_FOLLOW_UP_BODY[p.language](initiativeRole(p.vacancy.title), sentDay(p), p.vacancy.company)
    : FOLLOW_UP_BODY[p.language](positionTitle(p), sentDay(p));
  return { subject: replySubject(p), text: replyLayout(p, body) };
}

/** A polite answer to a rejection (template, no Claude). */
export function rejectionReply(p: ApplicationPackage): { subject: string; text: string } {
  const body = isInitiative(p.vacancy)
    ? INITIATIVE_REJECTION_BODY[p.language](initiativeRole(p.vacancy.title), p.vacancy.company)
    : REJECTION_BODY[p.language](positionTitle(p), p.vacancy.company);
  return { subject: replySubject(p), text: replyLayout(p, body) };
}
