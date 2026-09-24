# BewerbungsPilot

A local assistant for job applications in Germany. It will find job offers that fit your profile,
write your cover letter and a tailored CV, send the applications you approved from your own email
and help you keep track of every answer — all on your own Windows PC.

**Status: v0.1 — foundation.** The app installs, runs, speaks six languages, walks you through
the first steps and talks to Claude. Profile, job search, application packages and sending are
being built next.

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
