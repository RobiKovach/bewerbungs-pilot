# BewerbungsPilot 0.15.0 "Bewerbungsnachweis" — design

Status: written 2026-11-27 after a brainstorming session with Robert; waiting for his approval.
Comes before the "Simpler" version (notes: `2026-11-26-bewerbungspilot-simpler-brainstorm-notes.md`), which stays open.

## 1. Intent and why

People in a Maßnahme (like Robert, bbw "Kompakt DD 2026") and people registered with a Jobcenter or the
Agentur für Arbeit must hand in a proof of their applications ("Bewerbungsnachweis" / "Nachweis der
Eigenbemühungen") regularly. Today Robert fills a Word form by hand, copying title, company, contact and date
from the app — every week, partly incomplete (company address mostly empty, "Bewerbungsart" often unticked).

The app already knows all of it. Goal: **the person enters the form data once; afterwards one button produces the
filled Word file with every application not exported yet.** For everyone using the app, not only Robert.

## 2. Decided by Robert

- **For all users** (variant B): the app ships its own neutral "Bewerbungsnachweis" form; in addition the person
  may pick their own blank form. Robert's bbw form (footer code `QGZ-F-PP018-2`) is the first supported own form.
  The bbw form belongs to the bbw and is **never committed to the public repo** — it lives only in the person's
  profile files.
- **Only submitted applications** go in (sent by the app or marked "submitted via website"). Hidden / not-applied
  vacancies never ("nicht beworben — Gründe" stays empty).
- **"New" = not exported yet.** The app remembers per application that it went into a Nachweis.
- **Output = Word (.docx)**, not PDF (consultants want to correct by hand).
- **One-time setup, stored in the profile:** institution, advisor and everything the header needs. Asked when the
  person fills the profile section or at the first Nachweis export; editable later with "Edit".
- **Travels with "Transfer to another PC" and backups** — the setup, the own blank and the "already exported"
  marks.
- **Jobcenter / Agentur users too**, not only Maßnahme participants.
- **Build approach A** (below): one own filler for both forms.
- Order: this version first, as its own small release; "Simpler" afterwards.

## 3. Goals, non-goals, anti-goals

Goals
- One click ("Bewerbungsnachweis (N new)") → Save as → a correct .docx that opens in Word without repair.
- Fill every column the app knows, complete address included; never invent what it does not know.
- Robert's bbw form filled 1:1 in its own layout (same fonts, same fields, ticked checkboxes).
- More applications than rows → more pages of the same form, nothing cut off.

Non-goals (this version)
- Arbitrary unknown blank forms ("show me which column is which") — later, if testers ask.
- PDF output, printing, sending the Nachweis by e-mail.
- Listing vacancies the person did not apply to ("nicht beworben — Gründe").
- AI of any kind — this is plain code, nothing leaves the PC.

Anti-goals (a failure even if it works)
- Marking applications as exported although the file was not saved (the next Nachweis would miss them).
- A blank that silently comes out wrong (fields shifted by one column, wrong boxes ticked) — an unknown or
  changed form must be refused with a clear message, never "best effort".
- Data from the person's old filled forms surviving in the new file (old rows must be cleared).
- The bbw form or any real personal data in the repo, tests or fixtures.
- Asking newcomers about a Maßnahme in the welcome steps (the "Simpler" work just shortened them).

## 4. Constraints

- Local only; no new network calls; no AI.
- No new library: the app already has `yazl`/`yauzl` for zip; a .docx is a zip with XML (approach A).
- Profile, vacancies, applications and settings are already inside backups and the transfer file
  (`server/src/backup/format.ts`: `settings.json` + `profile/`, `vacancies/`, `applications/`). Store everything
  of this feature inside those, then it travels automatically.
- Schema changes need migrations and a newer-data guard (`server/src/data/health.ts`), as in every version.
- UI texts in all 6 languages (de/en/uk/ru/pl/ro, `npm run i18n:check`); **the document itself is always German**
  (it is for German authorities), whatever the UI language.
- Save as via the existing `showSaveFilePicker` path (0.13.1, start in Downloads), fallback = normal download.
- Demo mode: works on demo data like everything else.

## 5. Approaches (considered; Robert picked A)

- **A. One own filler for both forms (picked).** The neutral form is our own .docx with Word content controls,
  made once and shipped with the app; the app opens a blank, writes into the content controls, ticks
  checkboxes, clones the page block for more rows. The same code fills the bbw form.
  + no new dependency, one mechanism, exact look. − more own work on Word XML; "own blank" only for known forms.
- **B. docxtemplater for the neutral form + own code for the bbw form.** + neutral form easiest. − cannot fill a
  form without `{tags}`, so own code is needed anyway → two mechanisms + a dependency.
- **C. Neutral form as PDF (existing Edge print) + own code for the bbw form.** − PDF cannot be corrected by
  hand; Robert asked for Word.
- (`docx` npm library: generates documents from scratch, cannot fill an existing form — ruled out.)

## 6. Data

### 6.1 Profile v5: `nachweis`

`Profile.schemaVersion` 4 → 5, new field (migration: `nachweis: null`):

```ts
interface NachweisSetup {
  /** Who the proof is for — decides which header fields are asked. */
  audience: 'measure' | 'jobcenter' | 'agentur';
  /** Name as printed; default = profile personal name, editable. */
  personName: string;
  /** audience 'measure' */
  measure: { provider: string; name: string; entry: string /* YYYY-MM-DD or '' */; exit: string; advisor: string } | null;
  /** audience 'jobcenter' | 'agentur' */
  office: { name: string; customerNumber: string /* Kundennummer / BG-Nummer */; advisor: string } | null;
  /** Which blank is filled. */
  blank: { kind: 'standard' } | { kind: 'own'; file: StoredFile; form: KnownFormId };
  updatedAt: string;
}
type KnownFormId = 'bbw-qgz-pp018';
```

- The own blank file is stored in the profile files folder like CV and documents (so it is in backups/transfer).
- `nachweis` is **not** part of profile readiness; packages never need it; the welcome steps never ask it.
- Field limits like other profile fields (builder: reuse the existing limits).

### 6.2 "Already exported" mark

New history event kind `nachweis` (`HistoryEventKind`, like `followUp`): `{ kind: 'nachweis', at, note: <file name> }`.
Appending it to a frozen (sent/submitted/…) package is allowed, as for `followUp`. The validator lists history
kinds explicitly (`HISTORY_KIND` in `server/src/applications/schema.ts`), so **package schema 7 → 8** (migration:
nothing to change; newer-data guard in `data/health.ts`). It never changes status, stats, reminders or interview prep.

Undo (Claude's call): `canUndo`/`undoLast` (`server/src/applications/status.ts`) skip `nachweis` entries and undo
the last *status* entry. Undoing `sent`/`submitted` is allowed as today; the package's `nachweis` entries are
removed with it (it is no longer a submitted application, so it is no longer a candidate). Check that adding the
event bumping `updatedAt` does not trigger "package changed" logic for frozen packages.

An application counts as **exported** when its history has any `nachweis` entry. "Copy as new draft" does not
copy it (history is not copied).

### 6.3 Which applications

A package is a candidate when its history has a `sent` or `submitted` entry (also after a later
interview/rejected/offer/withdrawn). Each such package is one row — two sent packages for the same vacancy
(re-send copy) are two rows. Sorted by application date, oldest first. Default selection = not exported yet.

## 7. Row content (both forms)

| Column | Source |
|---|---|
| Found on / initiative | not initiative → found date = vacancy `foundAt` (date only); initiative → "Initiativbewerbung" box ticked, no date. Vacancy deleted → found date empty. |
| Position (with reference no.) | package `vacancy.title`; Arbeitsagentur offers add `(Ref.-Nr. <refnr>)` — from the vacancy's `sourceId`, or parsed from the AA job URL if the vacancy is gone. |
| Company (complete address) | company name, then street, then postcode + city, one per line. Contact = the vacancy's current contact if the vacancy still exists (it may have been completed after sending), else the package's. Missing parts are left out, never guessed; only a complete street+postcode+city is shown as address (same rule as 0.13.0). |
| Contact person (name, phone) | "Frau/Herr Name"; then "Tel. …" if known; if no phone, the e-mail. Empty if nothing known. |
| Application date | date of the first `sent`/`submitted` history entry (local date, DD.MM.YYYY). |
| Kind of application | always "E-Mail, Internet" (sent by the app and submitted via website both are online). |
| Result | from the current status: sent/submitted → empty; interview → "Vorstellungsgespräch"; rejected → "Absage"; offer → "Zusage"; withdrawn → "zurückgezogen". |
| Not applied — reasons | always empty. |

Header "where I searched" boxes (bbw form; the neutral form has a "Quelle" column instead): tick "Portal JOBSUCHE
der Bundesagentur für Arbeit" if any row comes from Arbeitsagentur; "in anderen Internetjobbörsen" if any row is a
pasted link from another board; "Sonstiges: Firmenwebseiten" if any row comes from a followed company page
(`source: 'company'`) or a company website link. Pasted text without URL ticks nothing. Builder decides the exact
board-vs-company-site test from the vacancy URL (reuse the 0.13.0 board/ATS lists).

Dates in the document: `DD.MM.YYYY`.

Robert (2026-11-27): **auto-found contact fields** (`contactAuto`, not confirmed) **go into the document as they are**
(the letter went there), and the export dialog shows one line "N applications have an unconfirmed contact" with a
way to open them. **Page count follows the rows:** as many pages as needed (any number, not only 2); pages left
completely empty are removed (at least one page stays); empty rows on the last page stay, cleared. The same rule for
both forms.

Claude's calls: the "where I searched" boxes are the same on every page (they describe the whole period, computed
from all rows of the file). The bbw form can be chosen only with `audience: 'measure'` (it has no place for a
Kundennummer); with Jobcenter/Agentur only the standard form is offered.

## 8. The two forms

### 8.1 Neutral form (ours, German)

A .docx we design, shipped in the app (e.g. `server/assets/nachweis/standard.docx`), every field a content control
with a `w:tag` (e.g. `bp.row.company`, `bp.head.customerNumber`) so filling is by tag, not by position.

- Title "Nachweis über Bewerbungsbemühungen".
- Header: Name; for measure: Träger, Maßnahme, Eintritt–Austritt, Ansprechperson; for Jobcenter/Agentur: Stelle
  (office name), Kunden-/BG-Nummer, Ansprechperson (Arbeitsvermittler/in); Zeitraum = first–last application date
  of the rows.
- Table columns: Nr. · Bewerbungsdatum · Stelle (Ref.-Nr.) · Firma und Anschrift · Ansprechperson · Art ·
  Quelle (Arbeitsagentur / Jobbörse / Firmenwebseite / Initiativ) · Ergebnis.
- A fixed number of rows per page (builder: ~10, landscape A4); more → the page block is repeated.
- Footer: "Erstellt mit BewerbungsPilot", page x of y; a signature line "Datum, Unterschrift".
- How it is made (Word by hand, or generated once by a script and committed) — builder's call; it must open in
  Word without repair and its structure is covered by tests.

### 8.2 bbw form `bbw-qgz-pp018` (own blank)

Facts from Robert's real files (2026-11-27):
- 2 "pages", each = a header table + a rows table; 6 rows per page; 172 content controls in total, no tags.
- Per page header: 6 checkboxes + 2 text controls ("where I searched", with "andere Internetjobbörsen:" and
  "Sonstiges:" text). Name, Eintritt, Austritt, Maßnahme and Ansprechperson are **plain table text** next to labels
  ("Vorname Name:", "Eintritt:", "Austritt:", "Bezeichnung der Maßnahme:", "zuständige mitarbeitende Person:").
- Per row, 13 controls in this order: checkbox "Datum" · date "gefunden am" · checkbox "Initiativbewerbung" ·
  text Tätigkeit · text Firma · text Ansprechperson · date Bewerbungsdatum · 4 checkboxes (schriftlich, telefonisch,
  persönlich, E-Mail/Internet) · text Ergebnis · text Gründe.
- The second page's header says "Gesprächsperson" instead of "Ansprechperson" — the form is otherwise the same.
- Header/footer: "AKTIVITÄTENNACHWEIS", "QGZ-F-PP018-2 / 31.08.2023".
- XML details checked by Claude on the real file (2026-11-27): checkboxes are `w14:checkbox` with
  `w14:checkedState w14:val="2612"` (☒, font MS Gothic) / unchecked ☐; date controls are `w:date` with
  `w:fullDate`; a row has 8 cells holding the 13 controls (several controls share a cell: e.g. checkbox + date,
  4 Bewerbungsart checkboxes in one cell); the label and its value are in separate cells (value in a following
  cell of the same row, plain runs, no control); the two page blocks are separated by a paragraph with
  `<w:br w:type="page"/>` (2 `w:sectPr` in the body); the `QGZ` code is in `footer1–4.xml`, not in the body.
- **The builder may read Robert's real files locally during development** (they are on this PC in Downloads:
  `Bewerbungsnachweis*.docx`) to confirm structure, but never copy them or any text from them into the repo. The
  plan's first task dumps the structure (control kinds, cells, order — no personal text) and builds the synthetic
  test blank from that dump; `check:nachweis` against the real blank runs before the filler is called done.

Recognition (when the person picks the file, and again at every export): footer code `QGZ-F-PP018` + the exact
control pattern above (header 8 + n×13 per page) + the labels. Anything else → "This form is not supported yet —
use the standard form" (no partial filling). A form the person already filled is fine: **all row controls and
header checkboxes are cleared first**, then filled; plain-text header values next to the labels are replaced.

Filling: checkbox = set `w14:checked` and the visible symbol (☒/☐) together; date controls = set the shown text
(and `w:fullDate` if present); text controls = replace the content run keeping its formatting; multi-line company
address uses line breaks inside the control (`w:text w:multiLine="1"` is set there). More than 12 rows → clone the
second page block (header + rows table, with the page break) as often as needed; cloned controls get fresh unique
`w:id`s.

Tests use a **synthetic** blank with the same structure built in the test (never the real bbw file). A local-only
script `npm run check:nachweis -- <path-to-blank.docx>` fills a given real blank with fake rows for manual checks.

## 9. Flow and UI

### 9.1 Profile section "Bewerbungsnachweis"

New section on the profile page (not in the wizard), shown as "Not set up" until filled:
1. "Who is it for?" — Maßnahme / Jobcenter / Agentur für Arbeit.
2. The fields for that choice (name prefilled from the profile).
3. Form: "Standard form of the app" (default) / "My own form" → choose a .docx → recognised → "bbw form recognised";
   not recognised → message, stays on standard.
4. Save. Later: summary + "Edit".

### 9.2 Export (page "Applications")

- Button "Bewerbungsnachweis (N new)" (N = submitted, not exported). N = 0 → button still there, dialog says
  "nothing new" and offers "choose applications".
- Not set up yet → the setup from 9.1 opens in the dialog first, then continues.
- Dialog: list of the new applications (date, company, title), all ticked; "Show already exported" adds older
  ones (unticked, with "in Nachweis on <date>"); preview counts ("8 applications, 1 page").
- "Save as…" → Word Save-as dialog (start in Downloads), suggested name
  `Bewerbungsnachweis_<from>_<to>.docx` (DD.MM.YYYY).
- **Mark only after the file was written**: with the Save-as picker, after the writable closed successfully;
  cancel/failure → nothing marked. Fallback download (no picker) → mark when the download was handed to the
  browser (cannot know more; "Show already exported" is the way back).
- Each exported card on "Submitted" shows a small "In Nachweis <date>".

### 9.3 Server

- `GET /api/nachweis` — setup state + candidates (with exported flag/date).
- `PUT /api/profile/nachweis` (+ upload of the own blank, reusing the profile file upload limits and checks).
- `POST /api/nachweis/build` `{ applicationIds }` → the .docx bytes (nothing marked).
- `POST /api/nachweis/mark` `{ applicationIds, fileName }` → appends the `nachweis` history entries.
- Errors with clear codes (e.g. `NACHWEIS_NOT_SET_UP`, `NACHWEIS_FORM_UNKNOWN`, `NACHWEIS_FORM_CHANGED` if a stored
  own blank no longer matches) in all 6 languages.
- Busy guard like other long actions: no restore/update while a Nachweis file is being built (short, but same
  pattern as export).

## 10. Privacy and docs

- Nothing leaves the PC; no AI. The own blank and the setup are personal data inside the profile → in backups and
  the transfer file (encrypted transfer as today).
- README "What's new" + a short how-to; `privacy.html` only if wording about profile contents needs it (builder
  checks; date "effective" updated if changed). CHANGELOG, version 0.15.0.

## 11. Acceptance (with Robert)

- Robert's real bbw blank: pick `Bewerbungsnachweis10,11,2026.docx` (already filled) → old rows gone, his real
  submitted applications in, boxes ticked, opens in Word without repair (check on this PC with Word), compare
  visually with his hand-filled file.
- More than 12 applications → 3+ pages, layout intact.
- Standard form for a Jobcenter setup (fake data on a temporary data copy).
- Export twice → second time "nothing new"; "Show already exported" works.
- Transfer file / backup → restore on a temporary copy → setup, own blank and marks are there.
- e2e: setup → export standard form → file has the rows → marks set.

## 12. Left to the builder

- Exact content-control tags and layout of the neutral form; rows per page.
- Package schema bump or not (6.2).
- Board vs company-site test for the "where I searched" boxes (reuse 0.13.0 lists).
- How the page block is cloned and ids renumbered; where the shipped form lives in the release zip
  (`scripts/pack-zip.mjs` must include it).
- Field limits, i18n keys, exact texts.
