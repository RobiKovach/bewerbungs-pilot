# BewerbungsPilot 0.15.0 "Bewerbungsnachweis" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One button on "Applications" writes every submitted, not yet exported application into a filled Word Bewerbungsnachweis (the app's standard form or the person's own bbw form), from a setup the person enters once in the profile.

**Architecture:** A new server module `server/src/nachweis/` opens a .docx (zip via the existing `yauzl`/`yazl`), finds Word content controls in `word/document.xml`, writes values into them, clones/removes page blocks, and zips it back. Rows come from sent/submitted packages (+ the vacancy card when it still exists). The setup lives in the profile (v5), the "exported" mark is a `nachweis` history event in the package (v8), so backups and the transfer file carry both. The web gets a profile section and an export dialog that saves through the existing "Save as" helper.

**Tech Stack:** TypeScript, Node ≥22.12, Fastify, React + Vite, vitest, Playwright e2e; `yauzl` 3.4.0 / `yazl` 3.3.1 (already dependencies). No new dependency.

**Spec:** `docs/superpowers/specs/2026-11-27-bewerbungspilot-nachweis-design.md` (read it; this plan argues from it).

## Global Constraints

- No new npm dependency; no AI call; no network call in this feature.
- The real bbw form and any text from Robert's files (`C:\Users\dd-00-kovrob1\Downloads\Bewerbungsnachweis*.docx`) are **never** copied into the repo, tests or fixtures. Reading them locally to confirm structure is allowed.
- The generated document is always German; UI texts in de/en/uk/ru/pl/ro (`npm run i18n:check` green); uk texts use "ти" like the rest of the app.
- Dates in the document `DD.MM.YYYY` (local date of the PC).
- Profile schema 4 → 5, package schema 7 → 8, each with migration and the newer-data guard (`server/src/data/health.ts` already compares against the exported constants).
- Mark applications as exported **only** when the save result is `'saved'` or `'downloaded'`; never on `'cancelled'` or an error.
- An unknown or changed own form is refused with a clear error, never filled "best effort".
- Every new dialog/section must look right in light and dark theme and at 390 px (check with the demo copy, see memory `reference_bp_visual_check`).
- Subagents: no `npx` of packages not installed in the repo.
- Version 0.15.0 in `package.json`, `server/package.json`, `web/package.json` (release script checks they match).

## Review Focus

1. Company names/titles with `&`, `<`, `"`, umlauts/ß, emoji or a newline → XML-escaped, Word opens the file without "repair" (Task 2 test + Task 9 Word check).
2. Exactly 6, 12, 13 and 0 rows on the bbw form, and exactly one page / one page + 1 row on the standard form → page count and cleared leftover rows correct (Tasks 4, 5).
3. The vacancy card was hidden/deleted after sending, or an AA offer was later refreshed with another contact → row comes from the package (no found date, Ref.-Nr. parsed from the AA URL) or from the current card, never crashes (Task 3).
4. The stored own blank file is missing on disk or was replaced by another form → `NACHWEIS_FORM_CHANGED` with a way back to the standard form, not a 500 (Task 6).
5. Double click on "Save as" / the person cancels the window / writing to a pulled USB stick fails → nothing marked, no second mark (Task 8).

---

### Task 1: Types, profile v5, package v8, undo rule

**Files:**
- Create: `shared/types/nachweis.d.ts`; Modify: `shared/types/index.d.ts`, `shared/types/profile.d.ts` (Profile.schemaVersion 5, `nachweis: NachweisSetup | null`), `shared/types/application.d.ts` (`HistoryEventKind` + `'nachweis'`, `ApplicationPackage.schemaVersion: 8`), `shared/types/errors.d.ts` (`NACHWEIS_NOT_SET_UP`, `NACHWEIS_FORM_UNKNOWN`, `NACHWEIS_FORM_CHANGED`)
- Modify: `server/src/profile/schema.ts` (version 5, migration `4: (doc) => ({ ...doc, nachweis: null })`, JSON schema for `nachweis`), `server/src/applications/schema.ts` (version 8, migration `7: (doc) => doc`, `HISTORY_KIND` + `'nachweis'`), `server/src/applications/status.ts`, `server/src/profile/file-routes.ts` (`allFiles` includes `p.nachweis?.blank` own file)
- Test: `server/test/nachweis-schema.test.ts`, extend `server/test/application-status*.test.ts` (whichever file holds undo tests; else `server/test/nachweis-undo.test.ts`)

**Interfaces — Produces:**
```ts
// shared/types/nachweis.d.ts
export type NachweisAudience = 'measure' | 'jobcenter' | 'agentur';
export type KnownFormId = 'bbw-qgz-pp018';
export interface NachweisSetup {
  audience: NachweisAudience;
  personName: string;
  measure: { provider: string; name: string; entry: string; exit: string; advisor: string } | null; // entry/exit 'YYYY-MM-DD' | ''
  office: { name: string; customerNumber: string; advisor: string } | null;
  blank: { kind: 'standard' } | { kind: 'own'; file: StoredFile; form: KnownFormId };
  updatedAt: string;
}
export interface NachweisCandidate { packageId: string; company: string; title: string; appliedAt: string /*ISO*/; exportedAt: string | null; contactUnconfirmed: boolean }
export interface NachweisView { setup: NachweisSetup | null; candidates: NachweisCandidate[] }
```
- Limits: text fields `LIMITS.name` (300), `customerNumber` `LIMITS.short` (100); `measure` non-null iff audience `measure`, `office` non-null otherwise; own blank only with audience `measure` (schema or code check → `BAD_REQUEST`, reason `nachweisFormAudience`).
- `canUndo(p)` / `undoLast(p, now)` look at the last history entry whose kind is not `'nachweis'`; `undoLast` removes that entry (not trailing `nachweis` entries); afterwards, if no `sent`/`submitted` entry remains, every `nachweis` entry is removed.

- [ ] **Step 1: Write failing tests**
  - `profile v4 file migrates to v5 with nachweis null` (existing v4 fixture loads, `nachweis === null`, `schemaVersion === 5`).
  - `profile rejects office for audience measure` / `rejects own blank for jobcenter`.
  - `package v7 migrates to v8 unchanged; history accepts kind nachweis`.
  - `undo skips nachweis`: history `[approved, submitted, nachweis]` → `canUndo` true; `undoLast` → history `[approved]`, status `approved` (the `nachweis` entry is gone too).
  - `undo after reminder keeps nachweis when still submitted`: `[approved, submitted, nachweis, interview]` → undo → `[approved, submitted, nachweis]`, status `submitted`.
  - `sent can never be undone even with a later nachweis`: `[approved, sent(messageId), nachweis]` → `canUndo` false.
  - `data from version 6 profile / 9 package is reported newer` (health guard picks up the new constants).
- [ ] **Step 2:** `npm run test -w server -- nachweis-schema nachweis-undo` → FAIL.
- [ ] **Step 3:** Implement the types, migrations, schemas and the undo rule as stated above. Fix every compile error the new `schemaVersion` literals cause (fixtures, demo profile in `server/src/demo/demo.ts`, web types in `web/src/types.ts` if they mirror).
- [ ] **Step 4:** `npm run typecheck && npm run test -w server` → all PASS.
- [ ] **Step 5:** Commit `feat(nachweis): types, profile v5, package v8, undo skips nachweis`.

---

### Task 2: .docx read/write and content-control primitives

**Files:**
- Create: `server/src/nachweis/docx.ts`, `server/src/nachweis/controls.ts`, `scripts/dump-docx-controls.mjs` (prints control kinds/cell/row structure, **no text**), `server/test/helpers/nachweis-blanks.ts` (builds synthetic blanks in memory)
- Modify: root `package.json` script `"dump:docx-controls": "node scripts/dump-docx-controls.mjs"`
- Test: `server/test/nachweis-controls.test.ts`

**Interfaces — Produces:**
```ts
// docx.ts
export interface DocxParts { xml: Map<string, string>; binary: Map<string, Buffer> } // xml = every *.xml / *.rels entry as UTF-8
export function readDocx(buf: Buffer): Promise<DocxParts>;   // refuses non-zip, >200 entries, >20 MB unpacked, names with '..' or '\' → AppError NACHWEIS_FORM_UNKNOWN
export function writeDocx(parts: DocxParts): Promise<Buffer>; // '[Content_Types].xml' first, '/' in names
// controls.ts
export type ControlKind = 'checkbox' | 'date' | 'text';
export interface Control { kind: ControlKind; tag: string | null; start: number; end: number } // offsets of '<w:sdt>'…'</w:sdt>' in the xml
export type ControlValue = { checked: boolean } | { date: string /*DD.MM.YYYY or ''*/ } | { lines: string[] };
export function findControls(xml: string): Control[];                       // document order, nested sdt not expected (throw if found)
export function setControls(xml: string, edits: Map<number, ControlValue>): string; // index into findControls(xml); applied from last to first
export function renumberIds(xml: string, used: Set<number>): string;       // fresh unique w:id for every w:sdt in a cloned block
export function escapeXml(s: string): string;
```
Rules for `setControls` (spec 8.2): checkbox sets `w14:checked w14:val` 1/0 **and** the visible run text ☒ (U+2612) / ☐ (U+2610); date sets the shown text and `w:fullDate="YYYY-MM-DDT00:00:00Z"` (removes `w:fullDate` for ''); text replaces the runs of the content with one run keeping the first run's `w:rPr`, lines joined by `<w:br/>`; an empty value clears to an empty run (no placeholder `w:showingPlcHdr` left). Characters outside XML 1.0 are dropped.

- [ ] **Step 1 (local only, not committed output):** write `scripts/dump-docx-controls.mjs` and run it on Robert's real blank: `node scripts/dump-docx-controls.mjs "C:\Users\dd-00-kovrob1\Downloads\Bewerbungsnachweis10,11,2026.docx"`. Expected structure (spec 8.2): 172 controls, per page 8 header controls + 6 × 13 row controls, row = 8 cells. Paste the dump (kinds only) into the SDD journal; if it differs from the spec, stop and report.
- [ ] **Step 2: Write `nachweis-blanks.ts`** with `syntheticBbwBlank(opts?: { pages?: number; filledRows?: number }): Promise<Buffer>` reproducing exactly the dumped structure (labels "Vorname Name:", "Eintritt:", "Austritt:", "Bezeichnung der Maßnahme:", "zuständige mitarbeitende Person:", footer part containing `QGZ-F-PP018-2`, page-break paragraph between blocks, fake values like "Erika Beispiel") and `minimalDocx(bodyXml: string): Promise<Buffer>`.
- [ ] **Step 3: Write failing tests** in `nachweis-controls.test.ts`:
  - `readDocx/writeDocx round trip keeps every part byte-equal for binary and string-equal for xml`.
  - `findControls on synthetic bbw blank returns 172 controls, kinds match the dump`.
  - `setControls checkbox on → w14:checked 1 and ☒; off → 0 and ☐`.
  - `setControls date '10.11.2026' → text and w:fullDate 2026-11-10T00:00:00Z; '' → empty, no fullDate`.
  - `setControls text with ['A & B <GmbH>', 'Straße 1', '01067 Dresden'] → escaped, two <w:br/>, formatting of first run kept`.
  - `readDocx refuses a zip with '../x' or more than 200 entries`.
- [ ] **Step 4:** Implement until green: `npm run test -w server -- nachweis-controls`.
- [ ] **Step 5:** Commit `feat(nachweis): docx parts and content-control filling`.

---

### Task 3: Rows and candidates

**Files:**
- Create: `server/src/nachweis/rows.ts`
- Test: `server/test/nachweis-rows.test.ts`

**Interfaces:**
- Consumes: `ApplicationPackage`, `Vacancy` (`sourceId`, `source`, `foundAt`, `url`, `contact`, `contactAuto`, `initiative`), board/ATS host lists from `server/src/research/` (0.13.0; reuse the exported list, do not copy it).
- Produces:
```ts
export type RowOrigin = 'arbeitsagentur' | 'board' | 'company' | 'none';
export interface NachweisRow {
  packageId: string; initiative: boolean;
  foundAt: string;        // DD.MM.YYYY | ''
  position: string;       // title + ' (Ref.-Nr. <refnr>)' for AA
  companyLines: string[]; // [company, street, 'postcode city'] — address only when street+postcode+city all present
  contact: string;        // 'Frau Erika Beispiel, Tel. 0351 …' | 'Herr X, x@firma.de' | ''
  appliedAt: string;      // DD.MM.YYYY of first sent/submitted
  appliedIso: string;
  result: '' | 'Vorstellungsgespräch' | 'Absage' | 'Zusage' | 'zurückgezogen';
  origin: RowOrigin;
  contactUnconfirmed: boolean; // a contactAuto field is used in contact/companyLines
}
export function isSubmitted(p: ApplicationPackage): boolean;            // has a sent or submitted history entry
export function exportedAt(p: ApplicationPackage): string | null;       // last nachweis entry's `at`
export function buildRows(packages: ApplicationPackage[], vacancy: (id: string) => Vacancy | undefined): NachweisRow[]; // submitted only, oldest appliedIso first
export function toCandidates(packages: ApplicationPackage[], vacancy: (id: string) => Vacancy | undefined): NachweisCandidate[];
export function searchedBoxes(rows: NachweisRow[]): { aa: boolean; boards: boolean; companySites: boolean };
```
Origin: `source 'arbeitsagentur'` or AA host URL → `arbeitsagentur`; `source 'company'` → `company`; manual with URL on a known board/ATS host → `board`; other manual URL → `company`; no URL → `none`. Contact source: current card contact when the vacancy exists, else the package's `vacancy.contact`. Ref.-Nr.: `vacancy.sourceId`, else parsed from `/jobsuche/jobdetail/<refnr>` in the package URL.

- [ ] **Step 1: Write failing tests** (fake packages/vacancies built in the test):
  - `only sent/submitted packages, oldest first; a draft and an approved one are left out; a rejected-after-sent one is in with result 'Absage'`.
  - `initiative row: initiative true, foundAt ''`.
  - `AA row: position 'Frontend Developer (m/w/d) (Ref.-Nr. 10001-1234567890-S)'`; `vacancy deleted → Ref.-Nr. from URL, foundAt ''`.
  - `address only when complete: street missing → companyLines ['Firma GmbH']`.
  - `contact: 'Frau Erika Beispiel, Tel. 0351 123'`; `no phone → e-mail`; `nothing → ''`.
  - `contactUnconfirmed true when contactAuto includes email and email is shown`.
  - `card contact wins over package contact when the vacancy still exists`.
  - `searchedBoxes: one AA + one stepstone link + one company feed row → all three true; pasted text without URL → none`.
  - `two sent packages for the same vacancy → two rows`.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** `npm run test -w server -- nachweis-rows` → PASS.
- [ ] **Step 5:** Commit `feat(nachweis): rows and candidates from submitted packages`.

---

### Task 4: bbw form — recognise and fill

**Files:**
- Create: `server/src/nachweis/forms/bbw.ts`, `server/src/nachweis/forms/header.ts`, `scripts/check-nachweis.mjs`
- Modify: root `package.json` script `"check:nachweis": "node scripts/check-nachweis.mjs"` (runs against `server/dist`, like other check scripts)
- Test: `server/test/nachweis-bbw.test.ts`

**Interfaces:**
- Consumes: Task 2 primitives, Task 3 `NachweisRow`, `searchedBoxes`.
- Produces:
```ts
// header.ts
export interface NachweisHeader { personName: string; audience: NachweisAudience; provider: string; measureName: string; entry: string; exit: string; advisor: string; officeName: string; customerNumber: string; period: string /* '10.11.2026 – 17.11.2026' | '' */ }
export function toHeader(setup: NachweisSetup, rows: NachweisRow[]): NachweisHeader; // dates DD.MM.YYYY
// bbw.ts
export const BBW_ROWS_PER_PAGE = 6;
export function recognizeBbw(parts: DocxParts): boolean;
export function fillBbw(parts: DocxParts, header: NachweisHeader, rows: NachweisRow[]): DocxParts;
```
Recognition: a footer part contains `QGZ-F-PP018`; body has ≥1 page block; every page block = 8 header controls (6 checkbox, 2 text) + n × 13 row controls in the row pattern `checkbox, date, checkbox, text, text, text, date, checkbox×4, text, text`; all five labels present. Fill (spec 7, 8.2): clear every row control and header checkbox first; per page header boxes from `searchedBoxes` over **all** rows (Portal JOBSUCHE = 1st checkbox, andere Internetjobbörsen = 3rd, Sonstiges = 6th with text "Firmenwebseiten" in the 2nd text control — confirm the box order from the Step 1 dump of Task 2 and record it in the code comment); plain-text values replace the run(s) of the cell following each label (Name, Eintritt, Austritt, Maßnahme, Ansprechperson); row: checkbox "Datum" on + found date when not initiative, "Initiativbewerbung" on when initiative; Tätigkeit = `position`; Firma = `companyLines`; Ansprechperson = `contact`; Bewerbungsdatum = `appliedAt`; only "E-Mail, Internet" checked; Ergebnis = `result`; Gründe empty. Pages: `ceil(rows/6)` (min 1) — clone the **last** page block (from its header table through the page-break paragraph) with `renumberIds`; remove whole page blocks beyond that; the document's final `w:sectPr` stays last.

- [ ] **Step 1: Write failing tests** using `syntheticBbwBlank`:
  - `recognizes the synthetic blank; refuses minimalDocx; refuses the blank with one row control removed`.
  - `already filled blank (filledRows 9) → after fill with 2 rows no old text 'Erika'/fake company remains`.
  - `4 rows → 1 page (second block removed), rows 5–6 empty, header values replaced, page-break count 0`.
  - `6 rows → 1 page; 7 rows → 2 pages; 13 rows → 3 pages; 0 rows → 1 empty page`.
  - `13 rows → all w:id unique; findControls count = 3 × (8 + 6 × 13)`.
  - `AA + company rows → on every page box 1 and 6 checked and 'Firmenwebseiten' in Sonstiges; box 3 unchecked`.
  - `initiative row → Datum box off, Initiativ box on, found date empty`.
  - `writeDocx(fillBbw(...)) reads back with readDocx` (zip valid).
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** PASS.
- [ ] **Step 5:** write `scripts/check-nachweis.mjs <blank.docx> [--rows N] [--out file.docx]` (fills with N fake rows, default 14, writes next to the scratchpad/out path, never into the repo); run it locally on `Bewerbungsnachweis10,11,2026.docx` with `--rows 14`, open the result in Word via COM (`$w=New-Object -ComObject Word.Application; $d=$w.Documents.Open(<out>); $d.Close(); $w.Quit()`) → opens without the repair dialog; note the result in the SDD journal.
- [ ] **Step 6:** Commit `feat(nachweis): fill the bbw form (QGZ-F-PP018)`.

---

### Task 5: Standard form — make, ship, fill

**Files:**
- Create: `scripts/make-nachweis-standard.mjs` (writes `server/assets/nachweis/standard.docx` from XML strings with `yazl`; committed output), `server/assets/nachweis/standard.docx`, `server/src/nachweis/forms/standard.ts`, `server/src/nachweis/build.ts`
- Modify: `scripts/release.mjs` (add `'server/assets'` to the packed list), `scripts/pack-zip.mjs` only if it filters folders
- Test: `server/test/nachweis-standard.test.ts`, `server/test/nachweis-build.test.ts`

**Interfaces:**
- Produces:
```ts
// standard.ts
export const STANDARD_ROWS_PER_PAGE = 10;
export function standardBlankPath(): string; // fileURLToPath(new URL('../../../assets/nachweis/standard.docx', import.meta.url)) — same depth from src and dist
export function fillStandard(parts: DocxParts, header: NachweisHeader, rows: NachweisRow[]): DocxParts;
// build.ts
export function recognizeForm(buf: Buffer): Promise<KnownFormId | null>;
export function buildNachweis(blank: Buffer, form: 'standard' | KnownFormId, setup: NachweisSetup, rows: NachweisRow[]): Promise<Buffer>;
```
Standard form (spec 8.1): A4 landscape; title "Nachweis über Bewerbungsbemühungen"; header controls tagged `bp.head.name`, `bp.head.line1..3` (label+value pairs chosen by audience: measure → "Träger", "Maßnahme", "Zeitraum der Maßnahme" (entry–exit), "Ansprechperson"; jobcenter/agentur → "Stelle", "Kunden-/BG-Nummer", "Ansprechperson (Arbeitsvermittlung)"), `bp.head.period`; one page block = header + table with 10 rows; row controls tagged `bp.row.nr`, `bp.row.date`, `bp.row.position`, `bp.row.company`, `bp.row.contact`, `bp.row.kind` ("E-Mail / Internet"), `bp.row.origin` ("Arbeitsagentur" | "Jobbörse" | "Firmenwebseite" | "Initiativ" | ""), `bp.row.result`; footer "Erstellt mit BewerbungsPilot · Seite x von y" (PAGE/NUMPAGES fields); a "Datum, Unterschrift" line after the last block. Fill by tag; pages = `ceil(rows/10)` (min 1), same clone/remove rule as Task 4. Initiative rows: origin "Initiativ".

- [ ] **Step 1: Write failing tests:**
  - `standard.docx in assets is recognised as standard (recognizeForm → null) and has 10 rows per block, every control tagged`.
  - `fill 1 row → 1 page, row nr '1', other rows empty`; `11 rows → 2 pages, nr 1–11`; `0 rows → 1 page`.
  - `measure header shows Träger/Maßnahme lines; jobcenter header shows Kunden-/BG-Nummer`.
  - `buildNachweis with form 'bbw-qgz-pp018' on the synthetic blank → recognizeForm(result) === 'bbw-qgz-pp018'`.
  - `buildNachweis with own form but blank not recognised → AppError NACHWEIS_FORM_CHANGED`.
  - `release.mjs packs server/assets/nachweis/standard.docx` (assert on the list the script uses, or run the pack on a temp dir if the existing release test does that).
- [ ] **Step 2:** run → FAIL. **Step 3:** write the generator, run `node scripts/make-nachweis-standard.mjs`, implement `standard.ts`/`build.ts`. **Step 4:** PASS; open `standard.docx` and a filled 11-row result in Word via COM → no repair dialog (note in journal).
- [ ] **Step 5:** Commit `feat(nachweis): standard form shipped with the app`.

---

### Task 6: Server routes

**Files:**
- Create: `server/src/nachweis/routes.ts`, `server/src/profile/nachweis-routes.ts`
- Modify: `server/src/app.ts` (register both; after profile routes because the blank upload uses the multipart parser), `server/src/profile/files.ts` (`UploadKind` + `'nachweisBlank'`, rule `{ maxBytes: 5 MB, exts: ['.docx'] }`), `server/src/backup/routes.ts` (restore/update busy check also refuses while activity `'nachweis'` runs, reason `restoreBusyExport`), the update apply busy list the same way
- Test: `server/test/nachweis-api.test.ts`

**Interfaces — Produces (HTTP):**
- `GET /api/nachweis` → `NachweisView` (candidates oldest first, same order as the document).
- `PUT /api/profile/nachweis` body `{ audience, personName, measure, office }` → `ProfileView`; sets `blank: { kind: 'standard' }` when there was no setup; keeps an existing own blank only if audience stays `measure`, otherwise switches to standard and deletes the file (`removeQuietly`).
- `POST /api/profile/nachweis/blank` (multipart, one .docx) → `recognizeForm`; null → delete the upload, 400 `NACHWEIS_FORM_UNKNOWN`; no setup yet or audience ≠ measure → 409 `NACHWEIS_NOT_SET_UP` / 400 reason `nachweisFormAudience`; ok → store, old own blank removed quietly → `ProfileView`.
- `DELETE /api/profile/nachweis/blank` → back to standard → `ProfileView`.
- `POST /api/nachweis/build` body `{ applicationIds: string[] }` (1–500, `APPLICATION_ID`, each must be submitted else 409 `CONFLICT` reason `nachweisNotSubmitted`) → `.docx`, `Content-Type` docx, `Content-Disposition: attachment; filename="Bewerbungsnachweis_<from>_<to>.docx"` (dates `DD.MM.YYYY` of first/last row); no setup → 409 `NACHWEIS_NOT_SET_UP`; own blank missing or no longer recognised → 409 `NACHWEIS_FORM_CHANGED`. Runs under `activity` kind `'nachweis'`. Marks nothing.
- `POST /api/nachweis/mark` body `{ applicationIds, fileName }` (fileName ≤ 200) → appends `{ kind: 'nachweis', at: now, note: fileName }` to each submitted package via `addEvent` (signature gets an optional `note`) → `NachweisView`.

- [ ] **Step 1: Write failing tests** (app test harness like `application-api.test.ts`):
  - `GET without setup → setup null, candidates list submitted packages only`.
  - `PUT setup then GET → setup with blank standard`.
  - `upload synthetic bbw blank with audience measure → blank own bbw-qgz-pp018`; `upload a CV docx → 400 NACHWEIS_FORM_UNKNOWN and no file left in profile dir`; `upload with audience jobcenter → 400 nachweisFormAudience`.
  - `switch audience to jobcenter → blank standard and the own file deleted`.
  - `build returns a docx whose recognizeForm matches the setup; filename from first/last date; nothing marked`.
  - `build with a draft id → 409`; `build without setup → 409 NACHWEIS_NOT_SET_UP`; `own blank file deleted on disk → 409 NACHWEIS_FORM_CHANGED`.
  - `mark → candidates show exportedAt; marking twice adds a second entry and does not fail`.
  - `transfer export → import on a fresh data dir keeps setup, own blank and marks` (reuse the transfer test helper).
  - `restore refused while a build is running` (hold the build with a deferred fake, like the existing busy tests).
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** `npm run test -w server` all PASS.
- [ ] **Step 5:** Commit `feat(nachweis): API for setup, build and mark`.

---

### Task 7: Web — profile section and API

**Files:**
- Create: `web/src/nachweis/NachweisSetupForm.tsx`, `web/src/nachweis/NachweisSection.tsx`, `web/src/nachweis/api.ts`
- Modify: `web/src/pages/ProfilePage.tsx` (new section after the documents, outside the wizard and readiness), `web/src/files/save.ts` (`kind` + `'docx'` with `{ 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'] }`), `web/src/locales/*.json` (`nachweis.*`, error texts for the 3 codes and 2 reasons)
- Test: `web/src/nachweis/NachweisSetupForm.test.tsx`

**Interfaces:**
- Produces: `api.nachweis.get(): Promise<NachweisView>`, `api.nachweis.saveSetup(body)`, `api.nachweis.uploadBlank(file: File)`, `api.nachweis.removeBlank()`, `api.nachweis.mark(ids: string[], fileName: string)`, `buildUrlRequest(ids: string[]): () => Promise<Response>` (POST for `saveFile.make`); `<NachweisSetupForm initial={NachweisSetup|null} personName={string} onSaved={(p: ProfileView) => void} onCancel?={() => void} />` (used in the section and in the export dialog).
- Form (spec 9.1): radio "Für wen?" (Maßnahme / Jobcenter / Agentur für Arbeit); fields for that choice; name prefilled from profile; "Bogen": "Standardbogen der App" / "Mein eigener Bogen" (only for Maßnahme) → file input `.docx` → success "bbw-Bogen erkannt" / error text; Save; section shows "Nicht eingerichtet" or a summary + "Bearbeiten". Unsaved-changes guard like other profile editors (`web/src/profile/unsaved.tsx`).

- [ ] **Step 1: Write failing tests:** `shows measure fields by default and office fields after choosing Jobcenter`; `own form option hidden for Jobcenter`; `upload error NACHWEIS_FORM_UNKNOWN shows the translated text and keeps standard`; `save calls saveSetup with measure null for Agentur`.
- [ ] **Step 2:** run `npm run test -w web -- NachweisSetupForm` → FAIL. **Step 3:** implement. **Step 4:** PASS; `npm run i18n:check` green.
- [ ] **Step 5:** check look on the demo copy (light/dark, 390 px). Commit `feat(nachweis): profile section for the form setup`.

---

### Task 8: Web — export dialog, marks on cards and history

**Files:**
- Create: `web/src/nachweis/NachweisButton.tsx`, `web/src/nachweis/NachweisDialog.tsx`
- Modify: `web/src/pages/ApplicationsPage.tsx` (button in the page header), `web/src/vacancies/VacancyCard.tsx` (small "Im Nachweis <date>" next to the submitted badge — needs `exportedAt` in the list view: add `nachweisAt: string | null` to `ApplicationListView` items in `server/src/applications/views.ts` + shared type), `web/src/applications/HistoryBlock.tsx` (label for kind `nachweis` with the file name), locales
- Test: `web/src/nachweis/NachweisDialog.test.tsx`

**Behaviour (spec 9.2):** button "Bewerbungsnachweis (N neu)"; no setup → the dialog shows `NachweisSetupForm` first, then the list; list of candidates with `exportedAt === null` ticked; toggle "Bereits exportierte zeigen" adds the others unticked with "im Nachweis am <date>"; line "N Bewerbungen haben einen nicht bestätigten Kontakt" with a link to each package when any ticked candidate has `contactUnconfirmed`; summary "8 Bewerbungen, 1 Seite" (pages from the form's rows per page: 6 bbw / 10 standard); "Speichern unter…" → `saveFile({ kind: 'docx', suggestedName, make })` → on `'saved' | 'downloaded'` call `mark`, show "Gespeichert", refresh; on `'cancelled'` nothing; on error `ErrorBanner`, nothing marked. Button disabled while running (no double save). N = 0 → "Nichts Neues" + the toggle.

- [ ] **Step 1: Write failing tests:**
  - `ticks only not exported candidates`; `toggle shows exported ones unticked with date`.
  - `saved → mark called once with the ticked ids and the file name`; `cancelled → mark not called`; `save throws FILE_SAVE_FAILED → mark not called, error shown`.
  - `double click on save → saveFile called once`.
  - `unconfirmed contact line appears only when a ticked candidate has contactUnconfirmed`.
  - `without setup the setup form is shown first`.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** `npm run test -w web` PASS, `npm run i18n:check` green.
- [ ] **Step 5:** check look on the demo copy (light/dark, 390 px). Commit `feat(nachweis): export dialog and marks`.

---

### Task 9: e2e, docs, version 0.15.0

**Files:**
- Modify: `e2e/app.spec.ts` (new test), `README.md` ("What's new in 0.15.0" + short how-to), `CHANGELOG.md`, `docs/privacy.html` only if the list of profile contents needs the Nachweis setup (then update the "effective" date), versions in the three `package.json` files
- Test: `e2e/app.spec.ts`

- [ ] **Step 1: e2e test** `bewerbungsnachweis: setup → export standard → marked`: on the e2e data (after a package was sent with the fake mail), open Profile → set up "Jobcenter" → Applications → "Bewerbungsnachweis (1 neu)" → save (Playwright download) → the downloaded file is a zip with `word/document.xml` containing the company name → dialog reopened shows "Nichts Neues".
- [ ] **Step 2:** `npm run build && npm run test:e2e` (or the repo's e2e script) → PASS.
- [ ] **Step 3:** docs + version 0.15.0; `npm run lint && npm run typecheck && npm test && npm run i18n:check && npm audit` green (audit: report, do not fix unless the fix is ≥14 days old).
- [ ] **Step 4: Acceptance prep (with Robert, not by the agent alone):** on a temporary data copy (`BP_DATA_DIR`, port 4281) — own blank `Bewerbungsnachweis10,11,2026.docx` → export Robert's real submitted applications → open in Word on this PC, compare with his hand-filled file; >12 rows → 3+ pages; transfer file round trip. Delete the temporary copy afterwards.
- [ ] **Step 5:** Commit `chore: 0.15.0 Bewerbungsnachweis`. Then final whole-branch review → `bp-release` (stops for Robert's "так").
