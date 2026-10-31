# Changelog

Newest first. The short version of every release is also on the [Releases page](https://github.com/RobiKovach/bewerbungs-pilot/releases).

## What's new in 0.10.0

- **Try the demo.** The first setup step has a **Try the demo** button: it opens the whole app in a new tab with the
  sample person Max Mustermann — a checked profile, two stories and three sample job offers with scores. Create a
  package, look at the letter and the CV, "send" it: AI answers are examples and emails are only saved on your PC.
  No AI helper, no mailbox and none of your own data are needed. The demo runs on its own data folder
  (`%LOCALAPPDATA%\BewerbungsPilot\demo`) and never touches your profile; **Leave the demo** closes it.
- **Easier start.** The README begins with five steps, what you need and the two warnings you may see (Windows
  SmartScreen and Google) — with the reason they are safe. Screenshots in the README and on the website.

## What's new in 0.9.0

- **Backups.** **Settings → Backups** saves all your data as one zip file to `Documents\BewerbungsPilot\Backups`
  and restores it (from the list or from a file you choose). If Documents is synced with OneDrive, backups go to
  `%USERPROFILE%\BewerbungsPilot\Backups` on your PC instead, so personal data does not end up in a cloud by itself;
  you can choose another folder there (with a warning if it is a OneDrive folder). Before restoring, the app saves a backup of the current
  state; a backup from a newer app version asks you to update first.
- **Installer backup.** Before an update the installer saves a backup of your data and keeps its three newest backups;
  your own backups are never deleted.
- **New-version notice.** A bar under the menu says when a new version exists ("What's new", "Download", "×" hides
  it for that version). The check is once a day and can be switched off in **Settings → Updates** (see Privacy).
- **Applied tab.** Job offers you applied to get their own tab with the date of sending; offers you added yourself
  are never "weak" and come first.
- **Bigger preview.** Wider pages, the letter and CV preview close to real A4 size, and a "Full screen" button.
- **Fair search with several job titles.** The 50 new offers of one search are shared between all your job titles
  instead of the first title taking every slot.
- **Your note next to a link counts.** A short text next to a pasted link is your note (for example which position on
  the page you mean); the card keeps it. **Initiativbewerbung**: write it in the note and the app makes an initiative
  application card and an unsolicited cover letter.
- **Faster and safer.** The personal-data check no longer slows the app down on long texts; dependency updates;
  many small fixes from 0.8.x.

## What's new in 0.8.5

- **No administrator rights needed.** Without a suitable Node.js the installer now downloads the official Node.js zip
  from nodejs.org, checks its checksum and puts it into your own user folder
  (`%LOCALAPPDATA%\Programs\BewerbungsPilot-Node`). Work and school PCs without admin rights work now.
- **Clear message for the source code.** Running `install.bat` from the source code (the green **Code** button)
  now says to download the app from Releases instead of showing a PowerShell error.

## What's new in 0.8.4

- **Fix:** the desktop shortcut opens the app in your browser again (in 0.8.3 the app started but no browser
  window appeared on Windows).

## What's new in 0.8.3

- **Launch key.** The app opens only through its shortcut; other Windows users on this PC, and programs that cannot
  read your files, can no longer read your data through it. A bookmark or a typed address shows "Open BewerbungsPilot with its shortcut".
- **Personal-data warning.** If a letter, CV or email contains personal data that is not in your profile (another
  email address, phone number, IBAN, tax ID, birth date, address or link), a yellow note above "Approve" or "Send"
  names it and where it is. It is only a warning — you can still approve and send.
- **Security notes.** A new "Security" section above, [SECURITY.md](SECURITY.md) for reporting problems privately,
  automatic dependency and code checks on GitHub, and the installer now closes the running app safely before updating.
- **Pasted links are read.** "+ Add" with only a link (not Arbeitsagentur) now opens the page in a separate browser
  profile and reads the offer; internal addresses (your router, this PC) are always blocked. Some sites (StepStone,
  Indeed, LinkedIn) refuse — then paste the text.

## What's new in 0.8.2

- **Job titles on the job offers page.** Add or remove the job titles to search for right above "Search now"; they are
  saved to your job wishes.
- A search that finds nothing new now says why ("all found offers are already in your list", or "nothing found") and
  what to try, instead of "0 new offers scored".
- A score written in another language than the app's says so on the card; "Score again" writes it in the current language.

## What's new in 0.8.1

- **Node.js 22.12 or newer is now required.** Sign in with Google, making PDFs and reading PDF CVs need it. The installer
  checks the version and offers to install the current Node.js LTS if yours is older.
- The README says plainly that "Sign in with Google" is still in Google's testing mode and what to do meanwhile.

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
  Google shows "Google hasn't verified this app": click **Advanced → Go to BewerbungsPilot**. *(Outdated since
  2026-10-19: "Sign in with Google" is open to everyone now — no test-user list and no renewal every 7 days. Google has
  not verified the app yet, so the warning still appears; see "Warnings you may see" in the README.)*
- **Reminder after 14 days.** An application that was sent or submitted and has had no answer for 14 days gets a reminder:
  you see the text, can edit it and send it (or copy it, or dismiss it). One reminder per application.
- **Reply drafts.** For a rejection, a short polite thank-you reply from a template. For an offer, Claude writes a reply with
  the amount you enter. You check and edit it before anything is sent.
- **Statistics.** How many applications you sent and how many answers, interviews and offers came back, with a weekly chart
  of the last 8 weeks.
