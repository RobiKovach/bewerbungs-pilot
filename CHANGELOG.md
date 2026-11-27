# Changelog

Newest first. The short version of every release is also on the [Releases page](https://github.com/RobiKovach/bewerbungs-pilot/releases).

## What's new in 0.15.0

- **Bewerbungsnachweis.** If your Maßnahme, the Jobcenter or the Agentur für Arbeit wants a list of your applications,
  the app now fills it in Word. Set it up once in **Profile → Bewerbungsnachweis**: who it is for, the details on the form,
  and the app's standard form or — for a Maßnahme — your own empty bbw form (QGZ-F-PP018). On **Applications**,
  **Bewerbungsnachweis (N new)** lists your sent and submitted applications that are not in a Nachweis yet; **Save as…**
  writes the filled Word file where you choose, with as many pages as needed, and only then marks them "In Nachweis".
  The setup and your own form are part of backups and of the transfer file.
- A contact found automatically and not checked yet is written into the form as found; the window lists those
  applications so you can check them first.

## What's new in 0.14.0

- **Similar job titles.** Under the job titles above the search, **Suggest similar titles** asks the AI helper for
  titles close to your wishes, your past jobs, degrees and skills. Nothing is added until you tick a title and press
  **Add chosen**. A job title that brought nothing new for three search days is named, with what to try.
- **Companies I follow.** Paste the careers page of a company that uses Greenhouse, Lever, Ashby or Personio (for
  example `jobs.lever.co/<company>`) and its name. Every search also reads that company's public job list (at most every
  six hours) and keeps the offers that fit your job titles and cities; their cards say "from the company's careers page".
  Only the company's account name from the link is sent to that service. Up to 20 companies.
- **Daily search** (Settings → Daily search, off by default): while the app is open it searches once a day by itself and
  shows a banner with the new offers. At most 20 new offers a day are scored, which uses your AI allowance.
- Offers found only on a company's careers page can use **Find contact** and "About the company" like pasted offers.

## What's new in 0.13.4

- **Your data cannot seem lost any more.** If a newer version wrote it (for example after going back to an older one), the
  app leaves it untouched and says so, instead of showing empty lists. One damaged job offer or profile section no longer
  costs the rest: only that part is put aside, and the app tells you, with the way to your backups.
- **Weekly automatic backup** into your backup folder when the newest backup is older than a week; the three newest
  automatic ones are kept.
- An application that was saved but not yet in the list (power cut) is found again.
- Favourites are checked too: an offer the job board has removed gets a mark and stays in Favourites.
- Better contrast of buttons and check marks in the dark theme.

## What's new in 0.13.3

- The "Save as" window starts in your downloads folder (not in Documents, which Windows often syncs with OneDrive) and
  remembers the place you chose. The note about files without a password says so too.
- The home page no longer claims that the job search, packages and sending are still being built.
- **Find contact** in a package fills its empty fields at once instead of offering the value.

## What's new in 0.13.2

- **Company research is more careful.** A guessed site that redirects to a job board or a social network is never taken
  for the company's own site. A pasted offer page without an Impressum link is checked through the Impressum of its home
  page, and short names (three letters) are recognised too. On a job board the ad's own contact beats other addresses on
  the page.
- Saving a contact no longer shows an error when only the "found automatically" mark in the package could not be updated.
- Library updates, including the fixes for glob and minimatch; the released program has no known vulnerable library.

## What's new in 0.13.1

- **Choose where files are saved.** In Edge and Chrome, **Settings → Move to another PC → Save file** and every entry of
  the package's **Download** menu now open a "Save as" window: pick any folder on the PC or a USB stick straight away. The
  window suggests the same file names as before. If the file cannot be made, nothing is left behind; if it cannot be
  written there (stick removed, disk full), the app says so and you can choose another place. Closing the window just
  cancels. In browsers without this window (Firefox) files still go to your downloads folder.

## What's new in 0.13.0

- **About the company.** A job offer card now has an **About the company** block: the company website, what the
  company does, things worth knowing before you apply (only for you, never used in the letter, with a link to reviews on
  Kununu) and up to three facts the letter can use. For a pasted link it starts by itself; for offers from the job
  search press **Research the company**. The app itself reads a few public pages (the job page, the company site and its
  Impressum, contact, career or "about us" pages, at most six pages and one minute); the AI helper only summarises
  them. No news service is asked. Hide a fact with ✕ and the letter will not use it.
- **Contact found for you.** Empty contact fields (email, person, phone, address) are filled from those pages and marked
  "found automatically — please check". A field you filled yourself is never changed; a different value is offered in
  **Find contact** as "Found something different — Take". Sending to an address found automatically works, with a yellow
  note naming its domain until you confirm the contact.
- The package editor shows the company facts the letter was written with, and tells you when the card has new ones.
- The end-to-end test now covers the whole research on a local test site (company site, Impressum, a fact in the letter,
  a red flag that never reaches it) and no longer reaches the internet.

## What's new in 0.12.3

- **Works behind antivirus HTTPS scanning and company proxies.** The installation stopped with
  `SELF_SIGNED_CERT_IN_CHAIN` when an antivirus that checks HTTPS (or a company proxy) put its own certificate into
  Windows: Node.js only knew its own list. The installer and the shortcut now start Node.js with
  `--use-system-ca` (Node.js 22.15 or newer), so it trusts the certificates Windows trusts. With an older Node.js the
  installer offers to install a newer one for your Windows user; your own Node.js stays.

## What's new in 0.12.2

- Library updates (PDF making, translations, build tools). Nothing changes in how the app works. This is also the first version you can get with **Update now** from 0.12.1.

## What's new in 0.12.1

- **"Update now" works.** In 0.11.0 and 0.12.0 the button could not start the installer on Windows (the old version kept
  running and said the installer could not be started). Install 0.12.1 by hand once; from then on "Update now" installs new
  versions by itself.

## What's new in 0.12.0

- **Interview preparation.** A sent application now has an **Interview preparation** button. The AI helper writes questions for
  that job: about your own experience, theory for the role and one practical task, in German or English. You answer each
  one in your own words and get feedback: what was weak, your language mistakes and a short example of a better answer. At the
  end there is a summary by area, the biggest risk, a rough chance of passing (always shown with a note that it is only an
  estimate) and a list of weak answers you can repeat. Repeating shows the earlier figure next to the new one.
- The preparation is saved on your PC next to the application and removed with it. The application itself is not changed.
- The privacy policy now lists what the interview preparation sends to your AI helper.
- **Move to another PC.** **Settings → Move to another PC** saves all your data as one file, optionally encrypted with a password
  (AES-256; it cannot be recovered). On the new PC, **I already have a file** in the first welcome step opens it. The email
  password and the Google sign-in key are not in the file; a notice lists what is left to do (AI helper, mail, do not resend).
- The privacy policy describes the transfer file.
- **Faster start.** The libraries for PDFs, Word files, mail and the browser windows are loaded the first time they are
  needed, not at every start: about 600 fewer files to read, which matters most for the first start after switching on the PC.
- **"Starting BewerbungsPilot…"** The shortcut now opens a browser tab at once, and the same tab switches to the app as
  soon as it is ready. A second click while the app runs opens it in a new tab the same way. If that tab cannot open,
  the app opens the browser itself after about 10 seconds, as before.

## What's new in 0.11.0

- **Feedback.** A **Feedback** button in the top menu opens a window: Problem or Idea, your message, your email (for the
  answer), exactly what will be sent and a warning if the text seems to contain personal data. The message goes through the
  BewerbungsPilot cloud service (a Cloudflare Worker, mail via Resend) to the developer.
- **Daily anonymous "in use" signal.** A random install number and the app version, once a day. On by default, shown once
  as a notice; switch it off in **Settings** next to "Check for updates". The privacy policy describes it.
- **Update now.** The update banner can update the app in one click: it downloads only the official release from GitHub
  Releases, checks its sha256 from `version.json`, saves a backup of your data, installs silently and restarts. If anything
  fails, the old version keeps working (rollback) and you are told why. If you have 0.10.x or older, install 0.11.0 by hand once.
- **Fixed: unsolicited applications named two different roles.** The email, the reminder and the reply to a rejection now use
  the role from the subject line ("Initiativbewerbung als Webentwickler"), not the broader title of the card ("IT").
- Developer note: a rollback after the new version has already started may leave data written by the newer version. Any future
  schema change must accept running an older app on newer data, or refuse to start on it.
- Tests: the end-to-end run covers the feedback window, the absence of the signal in test mode and a failed update.

## What's new in 0.10.1

- **Cookie banner closes by itself.** In **Find contact**, the Arbeitsagentur cookie banner is now dismissed as soon as it
  appears, with **Alle Cookies ablehnen** (only necessary cookies) — you only solve the captcha. The program clicks only
  inside the banner on the Arbeitsagentur page, never anything else and never "accept".
- **Security updates.** nodemailer 10.1.7, undici 8.12.2, fast-uri and 22 small dependency updates.

## What's new in 0.10.0

- **Try the demo.** The first setup step and, after setup, the top bar have a **Try the demo** button: it opens the whole app in a new tab with the
  sample person Max Mustermann — a checked profile, two stories and three sample job offers with scores. Create a
  package, look at the letter and the CV, "send" it: AI answers are examples and emails are only saved on your PC.
  No AI helper, no mailbox and none of your own data are needed. The demo runs on its own data folder
  (`%LOCALAPPDATA%\BewerbungsPilot\demo`) and never touches your profile; **Leave the demo** closes it. Only
  this click starts the demo: a normal start always opens your own, empty profile.
- **Easier start.** The README begins with five steps, what you need and the two warnings you may see (Windows
  SmartScreen and Google) — with the reason they are safe. Screenshots in the README and on the website.
- **Find the employer's contact.** A job offer card has **Find contact**: it opens the offer page of the
  Arbeitsagentur in an Edge window (you solve the captcha, the program takes the contact and closes the window),
  reads the company's own page, or reads text you copied. Name, e-mail, phone and address go into the letter; you
  check the fields and press **Save**.
- **PDF links.** A link to a PDF (for example the job description) in the link field or in your note is read too;
  a scanned PDF without text gets a clear notice.
- Dependency updates (fastify 5.12.7) and small fixes.

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
