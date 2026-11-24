# BewerbungsPilot 0.14.0 "More vacancies" — implementation plan

Outline approved by Robert 2026-11-24 (A similar titles → C daily search → B company career feeds). This plan awaits his approval.
Order of work: A, C, B. After every task: tests green, commit, journal + AITasker CLAUDE.md, report.

## Global rules
- No new runtime library. Never mass-collect from Indeed/StepStone. Adzuna/Arbeitnow not in this version.
- The AI only proposes; nothing in the profile changes without the person's click.
- All 6 languages; `npm run i18n:check`. Demo and fake modes: no daily search, no real network.
- New schema versions (settings v6, vacancies v6) are protected on downgrade by 0.13.4's newer-data screen (vacancies).
  Settings are not covered by that screen: check what 0.13.4 does with a v6 settings file before writing the migration.

## Task 1 (A) — similar job titles, server
- New AI task `similar-titles` in `LLM_TASK_IDS` (+ fake answer; the existing test fails without it). Input: wished titles,
  experience titles, skills; no name, contact or address. Output: ≤8 `{title ≤100, why ≤150}`, strict schema for both helpers.
- Prompt: German titles as used in German job ads; nothing the profile does not support.
- Code drops titles already wished (case-insensitive) and repeats.
- `POST /api/vacancies/similar-titles` — nothing is saved. Every AI error as for the other AI routes.
- Tests: output checks, dropped duplicates, no personal data in the prompt, 409 without helper.

## Task 2 (A) — similar titles and quiet titles, web + search
- "Suggest similar titles" beside the title field in the search strip → list with checkboxes and reasons → "Add chosen"
  saves through the existing wishes route (same limits as adding by hand). Dirty wishes edits are not overwritten.
- The search job records per title how many finished searches in a row brought no new offer (`title-stats.json`; only
  titles that were really queried without error; a title no longer wished is dropped; shown from 3 in a row).
  The hint offers: suggest similar titles / larger radius in the profile.
- "New" = the offer passed the filter and its query found it first, also when the 50 limit left it for later.
- The file is excluded from nothing: check that backup/restore lists include or deliberately skip it.
- Tests: counting, failed query does not count, stopped search does not count, hint visible at 3.

## Task 3 (C) — daily search, server
- Settings v6: `vacancies.dailySearch: boolean` (default false; migration adds false).
- `DailySearch` (pattern: `AutoBackup`): first look 5 min after start, then hourly; runs when the last finished or tried
  automatic search is ≥24 h ago (`daily-search.json`, restarts do not repeat it; a clock set back does not block it forever).
  A manual search in the last 24 h counts too.
- Skipped when: off, demo/fake, onboarding or wishes incomplete, newer data, search running, restore/update running,
  no helper chosen. A skip is retried the next hour; a failure waits for the next day.
- `SearchJob.start({ maxNew })`: 20 for the automatic run, 50 by hand. `SearchState.automatic` marks the run.
  An update or restore during it behaves as with a manual search (409 busy).
- Tests: each skip reason, once a day, limit 20, failure does not loop, setting off mid-wait.

## Task 4 (C) — daily search, web
- Switch in Settings with the plain text: works while the app is open, uses the AI allowance, at most 20 offers a day.
- Banner after an automatic run with new offers: "N new offers" → opens "New"; closing it remembers that run.
  The banner stays quiet with 0 new; an AI limit is named in the vacancies page as today.
- No Windows notifications in this version.
- Tests: switch, banner once, closed stays closed. Look at light/dark, 1280/390 px.

## Task 5 (B) — company feeds: types, addresses, readers
Facts read 2026-11-24 (documentation):
| Service | Read without key | Address | Says about use |
|---|---|---|---|
| Greenhouse | yes | `boards-api.greenhouse.io/v1/boards/<token>/jobs?content=true` | requests may be rate limited; no word on third parties |
| Lever | yes | `api.lever.co` / `api.eu.lever.co` `/v0/postings/<site>?mode=json` | published postings are public and may be scraped by third parties |
| Ashby | yes (no key in the example) | `api.ashbyhq.com/posting-api/job-board/<name>` | may populate your own careers page; no word on third parties; `isListed=false` must not be shown |
| Personio | not stated, presented as public | `<account>.jobs.personio.de/xml` | no word on third parties |
Only Lever says clearly that third parties read the postings. **Gate (Robert decides):** Lever only, or all four with gentle use.
Gentle use = only companies the person added, at most one request per company per search (no more than once in 6 h),
link always to the company's own page, offers marked with the company as source.
Not read: Greenhouse and Ashby terms (404), Personio support article (403).
- `VacancySourceId` + `'company'`; vacancies v6; `sourceId` = `<service>:<account>:<id>` (limit 64 → check and raise).
- `parseCompanyLink(url)`: recognises the service and account from a board link only (strict account pattern); any other
  link → "not a supported careers page". No guessing from a company's own domain in this version.
- Readers through `research/safe-get.ts`: fixed hosts only, redirects only inside the same service, ≤5 MB, 15 s.
  HTML → text with the existing cleaner; broken single offers are skipped. Personio XML: own small parser without entities
  beyond the five standard ones and CDATA (no DTD); publish date only from `createdAt`, else ''.
- Remote: Lever/Ashby from the field; Greenhouse/Personio 'unknown' unless the text of the location says remote.
- Tests with saved small sample answers; hostile cases (other host, huge body, DTD, `isListed: false`, http link).

## Task 6 (B) — company list and search
- `companies.json` (≤20: id, name, service, account, addedAt, lastReadAt, lastError), included in backup/restore.
  `GET/POST/DELETE /api/companies`; adding reads the feed once to prove it exists and shows the number of offers.
- Search: after the Arbeitsagentur queries, one read per company; a failing company is a warning, never a failed search;
  companies also work when Arbeitsagentur fails (and the other way round).
- Filter for company offers, in addition to today's: the title must share a significant word with a wished title or an added
  similar title, and the place must name a wished city or be remote (no radius: there are no coordinates). Unknown place passes.
- Own fair share: companies are one group in `takeFairly`. Same offer from Arbeitsagentur and a company: existing duplicate check.
- Removed offers: only when the feed was read successfully and the offer is missing.
- Deleting a company keeps its cards. AA-only code (contact window, "load again", link migration, `cardFrom`) checked one by one
  for `source === 'arbeitsagentur'` versus `'manual'` assumptions.
- Tests: each of the above.

## Task 7 (B) — companies, web
- Block "Companies I follow" on the vacancies page: paste link → add, list with last read/error, remove.
- Card shows "from the company's careers page"; error texts; 6 languages. Light/dark, 1280/390 px.

## Task 8 — end to end, documents, 0.14.0
- e2e: suggest titles → add; company feed from the test server → card. Test addresses only in test mode.
- `privacy.html` (titles/skills go to the AI helper; which services are asked and that only the company's account name goes
  there; effective date = release date), README, CHANGELOG, version 0.14.0.
- Live check with the real helper on invented Max Mustermann, one real feed per allowed service.
- Full checks, archive, report; `bp-release` only after "так".

## Not in this version
Automatic recognition of a company's system from its own website, radius for company offers, Windows notifications, Workday/SAP.
