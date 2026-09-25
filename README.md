# BewerbungsPilot

A local assistant for job applications in Germany. It will find job offers that fit your profile,
write your cover letter and a tailored CV, send the applications you approved from your own email
and help you keep track of every answer — all on your own Windows PC.

**Status: v0.2 — foundation and profile.** The app installs, runs, speaks six languages, walks you
through the first steps, talks to Claude and builds your profile from your CV and your own stories.
Job search, application packages and sending are being built next.

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
