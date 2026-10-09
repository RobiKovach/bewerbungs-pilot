# BewerbungsPilot

A local assistant for job applications in Germany. It will find job offers that fit your profile,
write your cover letter and a tailored CV, send the applications you approved from your own email
and help you keep track of every answer — all on your own Windows PC.

**Status: v0.7 — foundation, profile, job offers, application packages, sending, statuses, reminders and statistics.** The app installs, runs,
speaks six languages, walks you through the first steps, talks to Claude, builds your profile from your CV and your own
stories, finds job offers that fit your profile, writes an application package (cover letter + tailored CV) for the
offers you choose, sends it from your own email, keeps track of the status of every application, reminds you to follow up and helps you answer.

## Requirements

- Windows 10 or 11
- A Claude account that can use [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
  (the installer sets up Claude Code and Node.js for you)

## Install

1. Download `BewerbungsPilot-vX.Y.Z.zip` from the Releases page and unzip it.
2. Double-click `install.bat` and answer the questions.
3. Start the app any time with the **BewerbungsPilot** shortcut on your desktop.

Your data stays on your PC in `%LOCALAPPDATA%\BewerbungsPilot`. Updating = run the new
installer; your data is kept.

## Languages

Українська · English · Deutsch · Русский · Polski · Română.
German, Russian, Polish and Romanian are machine-translated — corrections are welcome.

## Your profile

The profile is the basis of every application. Upload your CV (PDF or Word) or fill in the same sections yourself.
Claude reads the CV and fills in personal details, education, work experience, skills and languages; every field it
filled is marked **"AI – please check"** until you save or confirm it. Then Claude asks 3–7 short personal questions
and turns your answers into a *story bank* — true, concrete stories that cover letters are later built from (a cover
letter should tell what you did, not repeat your CV). You can add a CV photo (cropped to 3:4) and PDF documents to attach.

- Everything stays on your computer: `%LOCALAPPDATA%\BewerbungsPilot\profile\`.
- Claude only ever sees a copy of your CV in a throw-away folder, never your own folders.
- Nothing is made up: Claude may only use what your CV and your answers say.
- Applications can only be written once every section is checked ("All correct").

## Job offers

BewerbungsPilot searches the job board of the Federal Employment Agency (Bundesagentur für Arbeit) for your job titles,
cities and search radius from your profile ("Job wishes"). Offers you have already seen, and formats you did not ask for
(internships, apprenticeships, student jobs), are left out without asking Claude. Claude then scores every new offer
from 0 to 100 and says in two or three points why it fits and what is missing.

- "★ Interesting" keeps an offer in your favourites; "Not interesting" hides it for good (you can bring it back).
- Offers the job board has removed move to "Removed by the job board" by themselves.
- Found an offer somewhere else? Paste its text with "+ Add" — Claude reads it and scores it the same way.
- Up to 50 new offers per search; the search runs in the background and can be stopped at any time.
- Stored on your computer: `%LOCALAPPDATA%\BewerbungsPilot\vacancies\`. BewerbungsPilot only talks to
  `rest.arbeitsagentur.de`; it never opens links you paste.

## Application packages

- Mark a job offer as **Interesting**, then click **Create package** on its card. Choose German or English for the
  documents (the language of the offer is suggested).
- You need a checked profile (personal details, education, experience, skills, languages) and at least one checked
  story that may be told to employers.
- Claude writes the cover letter from your stories — one or two true stories tied to what the offer asks for, never a
  list of skills from your CV — and tailors the CV: descriptions translated into the document language, the skills
  that matter first, a short Profile at the top. Nothing is made up; your "never mention" list is respected.
- The CV shows a round photo (crop it in a circle in your profile), a job title chosen for each offer (you can edit
  it), up to 3 links from your profile, and skills in groups. Education entries of type course or certificate get
  their own "Further training & certificates" section.
- Countries and language names are translated into the document language.
- Edit every part of the letter yourself or ask Claude to change it. The letter must fit on one page before you can
  approve the package. Any change after approving makes it a draft again.
- Download the letter, the CV and your attachments one by one, or everything as one PDF. PDFs are made with
  Microsoft Edge or Google Chrome installed on your computer.

## Email and sending

- Connect your mailbox in Settings with an app password (a separate password for apps) and send a test email. Gmail,
  GMX, WEB.DE, T-Online, Yahoo and iCloud are filled in automatically; other providers (e.g. Outlook.com) are entered by hand.
- Send an approved package from the app: you see and can edit the email first, and a copy goes to your own mailbox.
- Applied on a company website instead? Mark the application as submitted.
- Track the status and history of every application (sent, interview, rejected, offer, withdrawn) on the Applications page.
  A package that was sent can no longer be changed.

## What's new in 0.7.0

- **Sign in with Google.** For a Gmail mailbox you now sign in with Google instead of an app password. It sends over a normal
  secure web connection, so it also works on networks that block mail ports. While the Google app is still in testing mode,
  Google shows "Google hasn't verified this app": click **Advanced → Go to BewerbungsPilot**. You must be added as a test
  user first, and in testing mode the sign-in has to be renewed every 7 days.
- **Reminder after 14 days.** An application that was sent or submitted and has had no answer for 14 days gets a reminder:
  you see the text, can edit it and send it (or copy it, or dismiss it). One reminder per application.
- **Reply drafts.** For a rejection, a short polite thank-you reply from a template. For an offer, Claude writes a reply with
  the amount you enter. You check and edit it before anything is sent.
- **Statistics.** How many applications you sent and how many answers, interviews and offers came back, with a weekly chart
  of the last 8 weeks.

## Development

```
npm ci
npm run dev -w server     # API on http://127.0.0.1:4280 (add -- --fake-llm to avoid real Claude calls)
npm run dev -w web        # dashboard on http://localhost:5173
npm test && npm run i18n:check
npm run release           # builds release/BewerbungsPilot-v<version>.zip
```

## License

[PolyForm Noncommercial 1.0.0](LICENSE) — free for personal and other noncommercial use;
commercial use is not permitted.
