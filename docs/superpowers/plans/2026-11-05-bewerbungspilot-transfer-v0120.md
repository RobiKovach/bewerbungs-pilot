# Перенесення на інший ПК (0.12.0): план реалізації

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** людина зберігає один файл (за бажанням із паролем) і на іншому ПК відкриває його вже з першого вітального кроку, отримуючи свій профіль, вакансії й заявки.

**Architecture:** новий модуль `server/src/backup/encrypt.ts` шифрує наявний zip копії потоком. Експорт — новий маршрут `POST /api/transfer/export`. Імпорт — наявний `POST /api/backups/restore-upload`, який отримує необов'язкове поле пароля й далі йде через незмінний `restoreBackup`. У вебі спільний компонент імпорту використовують перший вітальний крок і новий блок у налаштуваннях.

**Tech Stack:** Fastify, `node:crypto`, React, vitest, Playwright. Нових бібліотек немає.

**Spec:** `docs/superpowers/specs/2026-11-04-bewerbungspilot-transfer-design.md`

## Global Constraints

- Жодних нових залежностей: лише `node:crypto` (AES-256-GCM, scrypt).
- Пароль необов'язковий, мінімум 8 символів, вводиться двічі, із прямим попередженням: забудеш пароль — файл не відкрити.
- Пароль не потрапляє в адресу, логи, налаштування й копії й не зберігається.
- Файл має розширення `.zip`; файл із паролем має в назві `-encrypted`.
- Неправильний пароль і пошкоджений файл не відрізняються для людини, дані при цьому не змінюються.
- Файл до 1 ГБ на сервері обробляється потоком, не читається в пам'ять повністю.
- Копії інсталятора й копії перед відновленням лишаються без пароля. Блок «Резервні копії» лишається як є.
- Пароль пошти, ключ Google не переносяться; номер установки лишається цього ПК (наявна поведінка `restore`).
- Об'єднання даних двох ПК немає: імпорт замінює дані через наявний `restoreBackup`.
- Нагадування після імпорту — разове, у браузері, без запису в налаштування.
- Усі тексти в 6 мовах (`npm run i18n:check`), `{{ai}}` замість назви помічника. Світла й темна тема, ширина телефона без горизонтальної прокрутки.
- Після КОЖНОЇ задачі: журнал цього плану, блок у `AITasker/CLAUDE.md`, коміт, звіт Роберту, чекати «так».
- Установка й публікація лише через `bp-release` з окремим «так» Роберта.

## Review Focus

1. Неправильний пароль, коли на ПК є дані: дані не змінюються, копія «перед відновленням» не створюється, файл у вікні лишається вибраним для нової спроби. Тест у задачах 2 і 4.
2. Файл із паролем вибрано в старому блоці «Резервні копії» (там немає поля пароля): окреме зрозуміле речення, а не «пошкоджена копія». Тести в задачах 2 і 4.
3. Програма впала між розшифруванням і прибиранням: незашифрована копія не лишається в `tmp/` після наступного запуску. Тест у задачі 2.
4. Пароль кирилицею або набраний на іншому ПК в іншій формі Unicode: файл відкривається. Тест у задачі 1.
5. Файл із новішою версією шифрування чи чужими завеликими параметрами scrypt: без виділення великої пам'яті, зрозуміла відмова, дані не змінюються. Тест у задачі 1.

---

### Task 1: Шифрування файлу

**Files:**
- Create: `server/src/backup/encrypt.ts`, `server/test/backup-encrypt.test.ts`
- Modify: `shared/types/errors.d.ts`, `server/src/errors.ts` (лише якщо причини там перелічені окремо)

**Interfaces:**
- Produces:
  - `ENCRYPTED_MAGIC = 'BPENC'`
  - `isEncryptedFile(file: string): Promise<boolean>`
  - `encryptFile(input: string, output: string, password: string): Promise<void>`
  - `decryptFile(input: string, output: string, password: string): Promise<void>`
  - `ErrorReason`: `'transferPasswordNeeded' | 'transferCannotOpen'`

Будова файлу: `BPENC` (5 байтів ASCII), версія `1` (u8), `logN`, `r`, `p` (по u8), сіль 16 байтів, nonce 12 байтів (усього 37 байтів заголовка, він іде в GCM як AAD), шифротекст, тег 16 байтів.

Значення: запис `logN=17, r=8, p=1`. Читання приймає лише `logN ≤ 18, r ≤ 8, p ≤ 2`, інакше `transferCannotOpen` без виклику scrypt. `maxmem` рахується з параметрів. Лише асинхронний `crypto.scrypt`. Пароль перед ключем: `password.normalize('NFKC')`.

- [ ] **Step 1: Написати тести, що падають**

У `backup-encrypt.test.ts`:
- `round trip restores identical bytes`, зокрема файл 5 МБ випадкових байтів;
- `the output does not contain the plaintext and starts with BPENC`;
- `two encryptions of one file differ` (сіль і nonce випадкові);
- `Cyrillic password in NFC opens a file made with its NFD form`: `'пароль-й'.normalize('NFD')` проти `'пароль-й'.normalize('NFC')`;
- `wrong password`, `one flipped byte in the body`, `one flipped byte in the header`, `truncated by 1 byte`, `shorter than header + tag`: кожен кидає `AppError` з `code: 'BACKUP_INVALID'`, `reason: 'transferCannotOpen'`, а вихідного файлу після цього немає;
- `version 2 in the header` кидає `BACKUP_NEWER`;
- `logN 30 in the header` кидає `transferCannotOpen`, і `crypto.scrypt` не викликався (spy);
- `isEncryptedFile`: true для зашифрованого, false для звичайного zip, порожнього й неіснуючого файлу не кидає (false).

- [ ] **Step 2: Запустити**

Run: `npx vitest run test/backup-encrypt.test.ts` у `server/`
Expected: FAIL, модуля немає.

- [ ] **Step 3: Реалізувати `encrypt.ts`**

Потоки: `pipeline` читання, шифру й запису. Розшифрування читає тіло діапазоном `37..size-16` і тег окремо; вихід пишеться в `<output>.partial` і перейменовується лише після успішного `final()`, інакше `.partial` видаляється. Помилки диска → `BACKUP_FAILED`.

- [ ] **Step 4: Запустити**

Run: `npx vitest run test/backup-encrypt.test.ts`
Expected: PASS.

- [ ] **Step 5: Коміт**

`git commit -m "feat(transfer): encrypt and decrypt a backup file"`

### Task 2: Експорт і пароль в імпорті на сервері

**Files:**
- Create: `server/src/backup/transfer-routes.ts`, `server/test/transfer-api.test.ts`
- Modify: `server/src/backup/routes.ts:155-181`, `server/src/app.ts` (реєстрація поруч із `registerBackupRoutes`; прибирання при старті)

**Interfaces:**
- Consumes: задача 1; `createBackup(root, { dir, kind: 'manual', appVersion })`
- Produces:
  - `POST /api/transfer/export`, тіло `{ password?: string }` (8–200 символів, `additionalProperties: false`) → потік файла з `Content-Disposition: attachment; filename="BewerbungsPilot-transfer-YYYY-MM-DD-HHMM.zip"` або `…-encrypted.zip`
  - `GET /api/transfer/status` → `{ hasData: boolean }`
  - `POST /api/backups/restore-upload` приймає поле `password` **перед** файлом
  - `removeTransferLeftovers(tmpDir: string): Promise<void>`

Важливо: у `server/src/profile/routes.ts:65` глобальні обмеження multipart `fields: 0, parts: 1`. Для `restore-upload` у виклику `req.file` задати `fields: 1, parts: 2`, не змінюючи глобальних.

- [ ] **Step 1: Написати тести, що падають**

У `transfer-api.test.ts`, на справжньому застосунку в тимчасовій теці:
- `export without a password gives a backup that restores`;
- `export with a password: name has -encrypted, body starts with BPENC, and restoring with the password brings the profile back`;
- `password shorter than 8 → 400 and the password is in neither the answer nor the log`;
- `upload with a wrong password: 422 transferCannotOpen, data unchanged, no before-restore backup created`;
- `encrypted upload without a password: 422 transferPasswordNeeded, data unchanged`;
- `plain backup with a stray password restores`;
- `the password appears in no log line after export and import`: прочитати файл логу, шукати рядок пароля;
- `tmp holds no upload-*, transfer-* files after success and after failure`;
- `removeTransferLeftovers removes upload-*.zip and transfer-* and leaves other tmp files alone`, і воно викликається при старті застосунку;
- `export during a restore → 409 restoreRunning`;
- `export larger than the upload limit → backupTooLarge`, щоб кожен створений файл можна було відкрити;
- `status: hasData is false on a fresh start, true after a vacancy is added`;
- без ключа запуску обидва нові маршрути → 401 (є наявний тест-перелік закритих маршрутів, додати туди).

- [ ] **Step 2: Запустити**

Run: `npx vitest run test/transfer-api.test.ts`
Expected: FAIL.

- [ ] **Step 3: Реалізувати маршрути**

Експорт: `d.activity.refuseDuringRestore()` → `createBackup` у `paths.tmp/transfer-<ms>/` → за наявності пароля `encryptFile` → потік у відповідь; тимчасова тека видаляється на закритті відповіді, також при обриві. Імпорт: після запису в `tmp/upload-*.zip`, якщо `isEncryptedFile`: без пароля `transferPasswordNeeded`, інакше `decryptFile` у `tmp/upload-*-plain.zip`, далі наявний `restore(...)`; обидва файли видаляються у `finally`. Пароль довший за 200 символів → `transferCannotOpen`. `hasData` рахувати зі сховищ (вакансії, заявки, непорожній профіль), а не з наявності файлів: свіжий запуск сам створює порожні файли.

- [ ] **Step 4: Запустити**

Run: `npx vitest run test/transfer-api.test.ts test/backup-api.test.ts`
Expected: PASS, старі тести копій без змін.

- [ ] **Step 5: Коміт**

`git commit -m "feat(transfer): export route and password on import"`

### Task 3: Блок «Перенести на інший ПК»: експорт

**Files:**
- Create: `web/src/settings/TransferSection.tsx`, `web/src/settings/TransferSection.test.tsx`
- Modify: `web/src/pages/SettingsPage.tsx:92` (окрема картка перед «Резервними копіями»; у демо не показувати, `useIsDemo`), `web/src/api.ts`, `web/src/applications/download.ts`, `web/src/locales/*.json`, `web/src/styles.css` за потреби

**Interfaces:**
- Consumes: `POST /api/transfer/export`
- Produces: `api.exportTransfer(password: string | null): Promise<void>`; `downloadResponse(res: Response, fallbackName: string): Promise<void>` винесено з `download`, поведінка `download` не змінюється

- [ ] **Step 1: Написати тести, що падають**

У `TransferSection.test.tsx`:
- `saving without a password calls export with null and shows the note about personal data and cloud`;
- `password under 8 characters or a different repeat: save is disabled and nothing is sent`;
- `the warning "forgotten password cannot be recovered" is visible as soon as a password is typed`;
- `after a successful save both password fields are empty`;
- `an error is shown and the password stays in the fields for another try`;
- `fields are type=password with autoComplete="new-password"`.

- [ ] **Step 2: Запустити**

Run: `npx vitest run src/settings/TransferSection.test.tsx` у `web/`
Expected: FAIL.

- [ ] **Step 3: Реалізувати компонент і тексти**

Ключі `settings.transfer.*` у 6 мовах. Заголовок картки: «Перенести на інший ПК». Запит іде з `CLIENT_HEADER`; помилки як `ApiError`, як у `download`.

- [ ] **Step 4: Запустити**

Run: `npx vitest run src/settings/TransferSection.test.tsx; npm run i18n:check`
Expected: PASS.

- [ ] **Step 5: Коміт**

`git commit -m "feat(transfer): settings card to save the transfer file"`

### Task 4: Імпорт із вітального кроку й налаштувань

**Files:**
- Create: `web/src/transfer/TransferImport.tsx`, `web/src/transfer/TransferImport.test.tsx`, `web/src/transfer/importNotice.tsx`, `web/src/transfer/importNotice.test.tsx`
- Modify: `web/src/onboarding/steps/WelcomeStep.tsx`, `web/src/settings/TransferSection.tsx`, `web/src/settings/BackupsSection.tsx:18-21`, `web/src/App.tsx`, `web/src/api.ts`, `web/src/locales/*.json`

**Interfaces:**
- Consumes: `POST /api/backups/restore-upload`, `GET /api/transfer/status`, `useSettings().reload`
- Produces:
  - `api.importTransfer(file: File, password: string | null)`: поле `password` у `FormData` додається **перед** файлом; `api.transferStatus()`
  - `isEncryptedBlob(file: Blob): Promise<boolean>` (перші 5 байтів = `BPENC`)
  - `<TransferImport onDone?: () => void />`
  - `markImported()` і `<ImportNotice />`: стан у пам'яті сторінки, без `settings` і без `localStorage`

- [ ] **Step 1: Написати тести, що падають**

У `TransferImport.test.tsx`:
- `plain file, empty PC: restores with no replace warning`;
- `plain file, PC has data: the replace warning must be confirmed first; Cancel sends nothing`;
- `encrypted file asks for the password; plain file does not`;
- `wrong password: reason transferCannotOpen is shown, the file stays chosen, a new password can be sent`;
- `newer file: BACKUP_NEWER shows the "update the app first" text`;
- `not a .zip or over 1 GB: refused before any request`, ті самі причини, що в `BackupsSection`;
- `success calls settings reload and markImported, and clears the password`;
- `while importing the controls are disabled and a status line shows`.

У `importNotice.test.tsx`: `shows three items once after markImported, a link goes to Settings, closing hides it, a new mount without markImported shows nothing`.

У `WelcomeStep.test.tsx`: `"I already have a file" opens the import`.

У `BackupsSection.test.tsx`: `reason transferPasswordNeeded shows its own sentence pointing to the transfer card`.

- [ ] **Step 2: Запустити**

Run: `npx vitest run src/transfer src/onboarding/steps/WelcomeStep.test.tsx src/settings/BackupsSection.test.tsx`
Expected: FAIL у нових тестах.

- [ ] **Step 3: Реалізувати**

У `WelcomeStep` кнопка «У мене вже є файл» під кнопкою «Далі», над пропозицією демо. `TransferSection` отримує той самий `TransferImport`. `ImportNotice` рендериться в `App` над сторінкою, також коли після імпорту знову видно вітальні кроки. Три пункти за розділом 6 спеку. `transferPasswordNeeded` і `transferCannotOpen` додати в `OWN_REASONS` і тексти `errors.reasons.*`.

- [ ] **Step 4: Запустити**

Run: `npm test --workspace web; npm run i18n:check`
Expected: PASS.

- [ ] **Step 5: Коміт**

`git commit -m "feat(transfer): open a transfer file from the first step and settings"`

### Task 5: e2e і документи

**Files:**
- Modify: `e2e/app.spec.ts`, `e2e/server.ts` (друга копія програми на порожній теці даних), `README.md`, `docs/privacy.html`, `CHANGELOG.md`

**Interfaces:**
- Consumes: задачі 1–4; `E2eEnv`

- [ ] **Step 1: Написати e2e-сценарій**

Тест `transfer: a password-protected file opens on an empty install from the first step`: у налаштуваннях зберегти файл із паролем (`page.waitForEvent('download')`) → назва містить `-encrypted`, перші байти `BPENC` → друга копія програми на порожній теці → перший вітальний крок, «I already have a file» → неправильний пароль показує помилку → правильний → вітальних кроків немає, видно нагадування з трьома пунктами, ім'я в профілі й заявка на місці. Другу копію зупинити й видалити її теку даних в `afterAll`.

- [ ] **Step 2: Запустити**

Run: `npm run e2e`
Expected: PASS усіх сценаріїв.

- [ ] **Step 3: Документи**

`privacy.html`: файл переносу створюється лише на вимогу людини й лежить там, куди вона його зберегла, програма нікуди його не надсилає; без пароля він не зашифрований; пароль ніде не зберігається. `README` і `CHANGELOG`: коротко, людською мовою, у наявному записі 0.12.0.

- [ ] **Step 4: Повна перевірка**

Run: `npm run typecheck; npm run lint; npm test; npm run i18n:check; npm audit --omit=dev; npm run build`
Expected: помилок немає; audit показує лише вже відомі Роберту 3 moderate або менше.

- [ ] **Step 5: Коміт**

`git commit -m "feat(transfer): end-to-end check and documents"`

## Після задач

1. Фінальне рев'ю (opus) усієї гілки 0.12.0: підготовка до співбесіди й перенесення разом. Передати рецензенту рішення й відкладені дрібниці з обох журналів, а також цей список знахідок задачі 9: e2e читає `before` після старту підготовки; немає перевірки, що стара цифра більше не показується як поточна; README занижує, що саме отримує ШІ-помічник.
2. Приймальна перевірка з Робертом: копія з цього ПК на іншому його ПК через флешку; підготовка до співбесіди на справжній заявці, на окремій копії даних, зі справжнім ШІ.
3. `bp-release`: дві зупинки на «так». Заодно перший справжній запуск «Оновити зараз» на цьому ПК з 0.11.0.
