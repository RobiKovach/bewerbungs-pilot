# BewerbungsPilot

A local assistant for job applications in Germany. It will find job offers that fit your profile,
write your cover letter and a tailored CV, send the applications you approved from your own email
and help you keep track of every answer — all on your own Windows PC.

**Status: v0.8 — foundation, profile, job offers, application packages, sending, statuses, reminders and statistics.** The app installs, runs,
speaks six languages, walks you through the first steps, talks to an AI helper (Claude or ChatGPT), builds your profile from your CV and your own
stories, finds job offers that fit your profile, writes an application package (cover letter + tailored CV) for the
offers you choose, sends it from your own email, keeps track of the status of every application, reminds you to follow up and helps you answer.

## Requirements

- Windows 10 or 11
- Node.js 22.12+ and one AI helper: Claude (paid subscription) or ChatGPT (free or paid ChatGPT account) — you choose and connect it inside the app
  (the installer sets up Node.js for you)

## Install

1. Download `BewerbungsPilot-vX.Y.Z.zip` from the Releases page and unzip it.
2. Double-click `install.bat` and answer the questions.
3. Start the app any time with the **BewerbungsPilot** shortcut on your desktop.

Your data stays on your PC in `%LOCALAPPDATA%\BewerbungsPilot`. Updating = run the new
installer; your data is kept.

## AI helper

In the first steps you choose who does the writing: **Claude** or **ChatGPT**. The app installs the helper for you and
walks you through signing in; you can switch at any time in Settings. Only one helper works at a time.

- Limits depend on your plan. With a free ChatGPT account the limit is small: one application package takes about 1–3
  requests, a job search up to about 5. When the limit is reached the app says so and stops; try again later or switch helper.
- Privacy: your CV and answers are sent to the helper's provider. On personal ChatGPT plans (free and paid), turn off
  "Improve the model for everyone" in ChatGPT Settings → Data controls so your texts are not used for training; this also
  covers Codex. See <https://help.openai.com/en/articles/7730893-data-controls-in-chatgpt>.

## Languages

Українська · English · Deutsch · Русский · Polski · Română.
German, Russian, Polish and Romanian are machine-translated — corrections are welcome.

## Your profile

The profile is the basis of every application. Upload your CV (PDF or Word) or fill in the same sections yourself.
The AI helper reads the CV and fills in personal details, education, work experience, skills and languages; every field it
filled is marked **"AI – please check"** until you save or confirm it. Then the AI helper asks 3–7 short personal questions
and turns your answers into a *story bank* — true, concrete stories that cover letters are later built from (a cover
letter should tell what you did, not repeat your CV). You can add a CV photo (cropped to 3:4) and PDF documents to attach.

- Everything stays on your computer: `%LOCALAPPDATA%\BewerbungsPilot\profile\`.
- The AI helper never gets access to your folders: Claude reads a copy of your CV in a throw-away folder, ChatGPT gets only its text.
- Nothing is made up: the AI helper may only use what your CV and your answers say.
- Applications can only be written once every section is checked ("All correct").

## Job offers

BewerbungsPilot searches the job board of the Federal Employment Agency (Bundesagentur für Arbeit) for your job titles,
cities and search radius from your profile ("Job wishes"). Offers you have already seen, and formats you did not ask for
(internships, apprenticeships, student jobs), are left out without asking the AI helper. The AI helper then scores every new offer
from 0 to 100 and says in two or three points why it fits and what is missing.

- "★ Interesting" keeps an offer in your favourites; "Not interesting" hides it for good (you can bring it back).
- Offers the job board has removed move to "Removed by the job board" by themselves.
- Found an offer somewhere else? Paste its text with "+ Add" — the AI helper reads it and scores it the same way.
- Up to 50 new offers per search; the search runs in the background and can be stopped at any time.
- Stored on your computer: `%LOCALAPPDATA%\BewerbungsPilot\vacancies\`. BewerbungsPilot only talks to
  `rest.arbeitsagentur.de`; it never opens links you paste.

## Application packages

- Mark a job offer as **Interesting**, then click **Create package** on its card. Choose German or English for the
  documents (the language of the offer is suggested).
- You need a checked profile (personal details, education, experience, skills, languages) and at least one checked
  story that may be told to employers.
- The AI helper writes the cover letter from your stories — one or two true stories tied to what the offer asks for, never a
  list of skills from your CV — and tailors the CV: descriptions translated into the document language, the skills
  that matter first, a short Profile at the top. Nothing is made up; your "never mention" list is respected.
- The CV shows a round photo (crop it in a circle in your profile), a job title chosen for each offer (you can edit
  it), up to 3 links from your profile, and skills in groups. Education entries of type course or certificate get
  their own "Further training & certificates" section.
- Countries and language names are translated into the document language.
- Edit every part of the letter yourself or ask the AI helper to change it. The letter must fit on one page before you can
  approve the package. Any change after approving makes it a draft again.
- Download the letter, the CV and your attachments one by one, or everything as one PDF. PDFs are made with
  Microsoft Edge or Google Chrome installed on your computer.

## Email and sending

- Connect your mailbox in Settings and send a test email. Gmail addresses use "Sign in with Google" (see What's new in 0.7.0 below).
  **"Sign in with Google" is still in Google's testing mode:** it only works for people the author has added as test users,
  Google shows "Google hasn't verified this app", and the sign-in has to be renewed every 7 days. Want to use it? Open an
  issue on GitHub and ask to be added. Until then, use another mailbox (e.g. GMX or WEB.DE) for sending, or send the
  PDFs yourself and mark the application as submitted. The app is going to be submitted for Google's verification later.
  For other providers you use an app password (a separate password for apps): GMX, WEB.DE, T-Online, Yahoo and iCloud are filled in
  automatically; others (e.g. Outlook.com) are entered by hand.
- Send an approved package from the app: you see and can edit the email first, and a copy goes to your own mailbox.
- Applied on a company website instead? Mark the application as submitted.
- Track the status and history of every application (sent, interview, rejected, offer, withdrawn) on the Applications page.
  A package that was sent can no longer be changed.

## What's new in 0.8.0

- **ChatGPT as a second AI helper** next to Claude. You pick one in the first steps or in Settings.
- The helper is installed and signed in from inside the app.
- **"Written by" badges** show which helper wrote each letter, reply and job score.
- PDF CVs are read as text for ChatGPT. For a scanned PDF, use a text PDF or a DOCX instead.
- The installer no longer installs Claude.

## What's new in 0.7.2

- **Unsaved changes are no longer lost silently.** Going to another page, switching the language, quitting or closing the tab first asks whether to drop them.
- "Never mention" now checks whole words ("Kunde X" no longer matches "Kunde Xylophon") and also the skill group names in the CV.
- While a mail window is open, the editor behind it cannot be used; if the package was changed meanwhile, it is loaded again.
- Switching to another Google account or to a password mailbox takes the old Google permission back.
- When the app stops answering during a search or while Claude works, it says so (with "Check again") instead of spinning on.
- Translation fixes (Romanian, Polish, Ukrainian, Russian) and small visual fixes.

## What's new in 0.7.1

- Reminders and replies sent with **Sign in with Google** now join the conversation of the application email in your Gmail.
- If you leave **"Send email on your behalf"** unticked on Google's page, the app now tells you exactly that and lets you sign in again.
- The email text names the position only (some job ads put the company name in front of the job title).
- Bigger text fields for email and reply texts, tidier buttons in the offer reply, a wider statistics chart.

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
npm run dev -w server     # API on http://127.0.0.1:4280 (add -- --fake-llm to avoid real AI helper calls)
npm run dev -w web        # dashboard on http://localhost:5173
npm test && npm run i18n:check
npm run release           # builds release/BewerbungsPilot-v<version>.zip
```

## License

[PolyForm Noncommercial 1.0.0](LICENSE) — free for personal and other noncommercial use;
commercial use is not permitted.
