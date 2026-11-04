# Підготовка до співбесіди 0.12.0: план реалізації

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** на відправленій заявці людина проходить 9 запитань за вакансією, відповідає текстом, отримує зауваження і бачить підсумок із цифрою шансів.

**Architecture:** новий модуль `server/src/interview/` зберігає `interview-prep.json` у теці заявки (пакет не змінюється) і викликає ШІ через наявну чергу `d.queue`. Нова сторінка `#/applications/:id/interview` у `web/src/interview/`. Голос у цей план не входить: тут лише окремий інструмент перевірки для Роберта вдома.

**Tech Stack:** Fastify, TypeScript, React, vitest, Playwright. Нових бібліотек немає.

**Spec:** `docs/superpowers/specs/2026-11-04-bewerbungspilot-interview-prep-design.md`

## Global Constraints

- Жодних нових залежностей.
- Статуси для старту й відповідей: `sent`, `submitted`, `interview`. Лише перегляд: `rejected`, `offer`, `withdrawn`. Для `draft`, `approved` підготовки немає.
- Набір: рівно 4 `experience`, 4 `theory`, 1 `practice`; 3 запитання до роботодавця поза лічильником.
- Відповідь до 5 000 символів. Мова співбесіди: `de` або `en`.
- Цифра: 5–95, кратна 5, округлення вниз, верхня межа `10 + 85 × частка не слабких`.
- `package.json` заявки ніколи не змінюється через підготовку, зокрема `updatedAt`.
- У логи йдуть лише id заявки, результат і коди помилок, ніколи тексти.
- Нічого не йде в Cloudflare. Текст іде лише вибраному ШІ-помічнику.
- Текст вакансії, листа й відповіді передається ШІ через `fenceUntrusted`.
- Усі тексти інтерфейсу в 6 мовах (`npm run i18n:check`), із `{{ai}}` замість назви помічника.
- Світла й темна тема, ширина телефона без горизонтальної прокрутки.
- Після КОЖНОЇ задачі: журнал `.superpowers/sdd/2026-11-04-bewerbungspilot-interview-prep/progress.md`, блок у `AITasker/CLAUDE.md`, коміт, звіт Роберту, чекати «так».
- Установка й публікація лише через `bp-release` з окремим «так» Роберта.

## Review Focus

1. Пошкоджений або несумісний `interview-prep.json` (після відновлення копії, ручної правки): файл відкладається, сторінка показує «почати», сервер не падає. Тест у задачі 1.
2. Людина закрила вкладку або ШІ упав посеред зауважень: відповідь збережена, запитання не пройдене, можна надіслати знову. Тест у задачі 4.
3. Статус заявки змінився або натиснуто «Нові запитання», поки ШІ ще відповідає: застарілий результат не записується. Тест у задачі 4.
4. Немає тексту вакансії (Initiativbewerbung, порожній файл): запитання будуються з листа й профілю, без помилки. Тест у задачі 3.
5. ШІ повертає інший розподіл запитань або ризик із невідомим id: одна повторна спроба, потім `LLM_BAD_OUTPUT`; нічого не записується. Тест у задачі 3.

---

### Task 1: Типи, сховище й розрахунок цифри

**Files:**
- Create: `shared/types/interview.d.ts`, `server/src/interview/schema.ts`, `server/src/interview/store.ts`, `server/src/interview/chance.ts`
- Modify: `shared/types/index.d.ts`
- Test: `server/test/interview-store.test.ts`, `server/test/interview-chance.test.ts`, `server/test/backup-core.test.ts`

**Interfaces:**
- Produces:

```ts
export type PrepKind = 'experience' | 'theory' | 'practice';
export interface LanguageFix { said: string; correct: string; why: string }
export interface PrepFeedback { weak: boolean; content: string; languageFixes: LanguageFix[]; better: string }
export interface PrepAnswer { text: string; dontKnow: boolean; updatedAt: string; feedback: PrepFeedback | null }
export interface PrepQuestion { id: string; kind: PrepKind; text: string; code: string | null; answer: PrepAnswer | null }
export interface PrepSummary {
  percent: number; previousPercent: number | null;
  areas: { experience: string; theory: string; practice: string; language: string };
  biggestRisk: { questionId: string; why: string };
  fingerprint: string; createdAt: string;
}
export interface InterviewPrep {
  schemaVersion: 1; applicationId: string; language: 'de' | 'en'; createdAt: string; updatedAt: string;
  questions: PrepQuestion[]; employerQuestions: string[]; summary: PrepSummary | null;
}
export interface InterviewPrepView { prep: InterviewPrep | null; canStart: boolean; readOnly: boolean; defaultLanguage: 'de' | 'en' }
```

`InterviewPrepStore(applicationsDir, warn)` з методами `read(id): InterviewPrep | null`, `write(prep): void`. Читає файл щоразу, без пам'яті, щоб після відновлення копії не було застарілих даних. Шлях: `<applications>/<id>/interview-prep.json`.

`chancePercent(raw: number, weak: number, total: number): number`, `answersFingerprint(prep: InterviewPrep): string` (sha256 від id, тексту, `dontKnow` усіх відповідей).

- [ ] **Step 1: Написати тести, що падають**

```ts
expect(chancePercent(85, 4, 9)).toBe(55);
expect(chancePercent(85, 9, 9)).toBe(10);
expect(chancePercent(63, 0, 9)).toBe(60);
expect(chancePercent(99, 0, 9)).toBe(95);
expect(chancePercent(2, 0, 9)).toBe(5);
```
Для `answersFingerprint`: однаковий для однакових відповідей, інший після зміни тексту, не змінюється від `updatedAt`.

Для сховища: запис і читання; файла немає → `null`; не JSON → відкладено в `interview-prep.corrupt-*.json`, `null`, `warn` без вмісту; чужий `schemaVersion` або `applicationId` → так само; небезпечний id (`..\\x`) → `BAD_REQUEST`.

У `backup-core.test.ts`: файл `applications/<id>/interview-prep.json` потрапляє в копію й відновлюється.

- [ ] **Step 2: Запустити й побачити падіння**

Run: `npm test -w server -- interview-store interview-chance backup-core`
Expected: FAIL, модулів немає.

- [ ] **Step 3: Реалізувати**

Запис через `writeJsonAtomic`, перевірка `APPLICATION_ID`, відкладення як у `ApplicationStore.setAsidePackage`, схема через той самий стиль, що `applications/schema.ts`. Помилка запису → `DATA_WRITE_FAILED`.

- [ ] **Step 4: Запустити й побачити успіх**

Run: `npm test -w server -- interview-store interview-chance backup-core`
Expected: PASS.

- [ ] **Step 5: Коміт**

`git add shared server && git commit -m "feat(interview): prep storage and chance calculation"`

### Task 2: Нічого не лишається від видаленої заявки й нічого не копіюється

**Files:**
- Test: `server/test/interview-store.test.ts`

**Interfaces:**
- Consumes: `InterviewPrepStore`, `ApplicationStore.remove`, маршрут `POST /api/applications/:id/copy`.

Це лише тести наявної поведінки; якщо хоч один падає, виправити код копіювання чи видалення.

- [ ] **Step 1: Написати тести**

`remove(id)` прибирає й файл підготовки. Заявка, створена через `copy`, має `read(newId) === null`. Перезавантаження `ApplicationStore.load()` не сприймає файл підготовки як пакет і не змінює `updatedAt`.

- [ ] **Step 2: Запустити**

Run: `npm test -w server -- interview-store`
Expected: PASS.

- [ ] **Step 3: Коміт**

`git add server/test && git commit -m "test(interview): prep file follows the application folder"`

### Task 3: Три ШІ-задачі

**Files:**
- Create: `server/src/interview/tasks.ts`
- Modify: `server/src/llm/types.ts`, `server/src/llm/fake-scripted.ts`
- Test: `server/test/interview-tasks.test.ts`, `server/test/fake-scripted.test.ts`

**Interfaces:**
- Consumes: `PackageContext`, `packageContext(profile, language, false, initiative)`, `fenceUntrusted`, `withFeedback`, `ApplicationPackage`.
- Produces: задачі `'interview-questions'`, `'interview-feedback'`, `'interview-summary'` у `LLM_TASK_IDS`.

```ts
interface TaskCtx { ctx: PackageContext; pkg: ApplicationPackage; vacancyText: string; language: 'de' | 'en'; uiLanguage: Language }
export function questionsTask(c: TaskCtx): LlmTask;
export function feedbackTask(c: TaskCtx, q: PrepQuestion, answer: { text: string; dontKnow: boolean }): LlmTask;
export function summaryTask(c: TaskCtx, prep: InterviewPrep, previousPercent: number | null): LlmTask;
export function questionsViolations(out: QuestionsOutput): string[];
export function summaryViolations(out: SummaryOutput, prep: InterviewPrep): string[];
```

Вихід: `QuestionsOutput = { questions: { kind; text; code: string | null }[]; employerQuestions: string[] }`, `FeedbackOutput = PrepFeedback`, `SummaryOutput = { percent: number; areas; biggestRisk }`. Усі схеми strict: кожне поле в `required`, `additionalProperties: false`, nullable через тип, як у наявних задачах.

Обов'язкові правила промптів (зі специфікації, розділи 4–8):
- **questions:** усе мовою співбесіди; «теорія» — фахові знання вакансії, «практичне» — усне завдання, код лише для технічної вакансії; можна спиратися на надісланий лист; не більше одного запитання на теми «ніколи не згадувати».
- **feedback:** `weak` = слабкий зміст або мову важко зрозуміти, менші мовні помилки не роблять слабким; `dontKnow` завжди `weak: true`, показує, що варто було сказати; `content` і `why` мовою інтерфейсу, `said`/`correct`/`better` мовою співбесіди; `better` лише з профілю, листа й того, що людина сказала в цій відповіді; ніякого вигаданого досвіду; немає досвіду → чесна відповідь; теми «ніколи не згадувати» лише на пряме запитання або якщо людина сама їх назвала; критика відповіді, не людини; без лестощів.
- **summary:** `percent` за відповідями; `previousPercent` змінюється лише через змінені відповіді; `areas` мовою інтерфейсу; `biggestRisk.questionId` з набору. Контекст не містить контактних даних (`PackageContext` це вже гарантує).

- [ ] **Step 1: Написати тести, що падають**

`questionsViolations` порожній для 4/4/1 + 3 запитань роботодавцю; повідомляє для 5/3/1 і 2 запитань роботодавцю. `summaryViolations` повідомляє про невідомий `questionId`. Порожній `vacancyText` і `initiative: true`: `questionsTask` не падає, промпт каже будувати з листа й профілю. Промпт `feedbackTask` містить відповідь лише в огорожі `fenceUntrusted`. Промпти не містять `fullName`, пошти чи телефону з профілю-прикладу. Схеми проходять наявну перевірку strict. `fake-scripted`: 9 запитань 4/4/1; відповідь `dontKnow` або коротша за 20 символів → `weak: true`, інакше `false`; `percent` дорівнює 90 мінус 10 за кожну слабку.

- [ ] **Step 2: Запустити й побачити падіння**

Run: `npm test -w server -- interview-tasks fake-scripted`
Expected: FAIL.

- [ ] **Step 3: Реалізувати задачі й фальшиві відповіді**

Зразок: `applications/tasks/offer-reply.ts`, `fake-scripted.ts: offerReply`.

- [ ] **Step 4: Запустити й побачити успіх**

Run: `npm test -w server -- interview-tasks fake-scripted`
Expected: PASS.

- [ ] **Step 5: Коміт**

`git add server && git commit -m "feat(interview): AI tasks for questions, feedback and summary"`

### Task 4: API

**Files:**
- Create: `server/src/interview/routes.ts`
- Modify: `server/src/app.ts`, `shared/types/errors.d.ts` (якщо причини типізовані)
- Test: `server/test/interview-api.test.ts`

**Interfaces:**
- Consumes: усе із задач 1 і 3, `d.queue.runTagged`, `abortOnClose`, `d.activity`, `d.profile`, `d.store`.
- Produces:

| Метод | Адреса | Тіло | Результат |
|---|---|---|---|
| GET | `/api/applications/:id/interview` | | `InterviewPrepView` |
| POST | `/api/applications/:id/interview` | `{ language, replace?: boolean }` | `InterviewPrepView` |
| POST | `/api/applications/:id/interview/questions/:qid/answer` | `{ text, dontKnow }` | `InterviewPrepView` |
| POST | `/api/applications/:id/interview/summary` | `{}` | `InterviewPrepView` |

Причини 409: `prepNotAvailable` (draft, approved), `prepReadOnly`, `prepExists` (без `replace`), `prepBusy`, `prepNotFinished`, `packageChanged`, `restoreRunning`, `updateRunning`.

Порядок відповіді: перевірка статусу → `refuseDuringRestore` → блокування id → запис відповіді з `feedback: null` (наявний `summary` лишається у файлі як джерело `previousPercent`, але веб не показує його, поки `fingerprint` не збігається) → виклик ШІ → повторне читання файла → якщо `createdAt` набору чи статус заявки змінились: 409 `packageChanged` → запис зауважень. Під час виклику відкрита `d.activity.begin(...)`: прочитати, як `busy()` в `app.ts` формує причини, і зробити так, щоб оновлення показувало наявний текст `updates.busyWhat.ai`.

`summary`: лише якщо кожне запитання має `feedback`. Якщо `fingerprint` збігається з наявним, ШІ не викликається. `previousPercent` = старий `percent`. Значення проходить через `chancePercent`, `weak` рахується за збереженими `feedback.weak`.

Мова за замовчуванням `defaultLanguage` = `package.language`. Мова інтерфейсу: `settings.language`. `vacancyText`: `store.readVacancyText`, запасний `vacancies.readText`, збій читання → порожньо.

- [ ] **Step 1: Написати тести, що падають**

На `--fake-llm` з готовою відправленою заявкою:
- старт для `sent`, `submitted`, `interview` дає 9 запитань; `draft` → `prepNotAvailable`; `rejected` → GET читає, POST → `prepReadOnly`;
- другий старт без `replace` → `prepExists`, із `replace` набір новий, `summary: null`;
- відповідь зберігає зауваження; `dontKnow` з порожнім текстом дозволено; порожній текст без `dontKnow` і 5 001 символ → 400;
- ШІ кидає `LLM_LIMIT`: 4xx/5xx як у наявних задачах, у файлі відповідь із `feedback: null`, повторна відправка спрацьовує (Review Focus 2);
- під час виклику ШІ змінено статус або замінено набір → `packageChanged`, застарілі зауваження не записано (Review Focus 3);
- два одночасні запити → другий `prepBusy`;
- під час відновлення → `restoreRunning`;
- підсумок до кінця → `prepNotFinished`; після всіх: кратно 5, 4 слабких із 9 і сире 85 → 55; другий виклик без змін не кличе ШІ; після зміни відповіді `previousPercent` = старе значення;
- `package.json` байт у байт однаковий до й після всього сценарію;
- після всього сценарію лог не містить тексту відповіді;
- без ключа запуску маршрути закриті (наявний тест на всі маршрути бачить нові).

- [ ] **Step 2: Запустити й побачити падіння**

Run: `npm test -w server -- interview-api`
Expected: FAIL.

- [ ] **Step 3: Реалізувати `registerInterviewRoutes(app, deps)` і підключити в `app.ts` поруч із `registerApplicationRoutes`**

Зразок обробки помилок і `signal`: `routes.ts:652` (`offer-reply`). Повторна спроба через `withFeedback` при `questionsViolations`/`summaryViolations`, потім `LLM_BAD_OUTPUT`; нічого не записувати (Review Focus 5).

- [ ] **Step 4: Запустити й побачити успіх**

Run: `npm test -w server`
Expected: PASS усіх серверних тестів.

- [ ] **Step 5: Коміт**

`git add server shared && git commit -m "feat(interview): API for prep, answers and summary"`

### Task 5: Вхід і сторінка з картками

**Files:**
- Create: `web/src/interview/InterviewPage.tsx`, `web/src/interview/QuestionCards.tsx`, `web/src/interview/KindArt.tsx`, `web/src/interview/format.ts`, `web/src/interview/InterviewPage.test.tsx`
- Modify: `web/src/api.ts`, `web/src/types.ts`, `web/src/pages/ApplicationsPage.tsx`, `web/src/applications/ApplicationEditor.tsx`, `web/src/styles.css`, `web/src/locales/*.json`

**Interfaces:**
- Consumes: API із задачі 4.
- Produces: `interviewRouteId(hash): string | null` для `#/applications/<id>/interview`; `questionState(q): 'open' | 'pending' | 'done' | 'weak'` (`pending` = відповідь є, зауважень нема); методи `api.interview(id)`, `api.startInterview(id, language, replace)`, `api.answerInterview(id, qid, body, signal)`, `api.interviewSummary(id, signal)`.

`ApplicationsPage` спершу перевіряє `interviewRouteId`, бо `applicationIdFromHash` таку адресу не приймає, а `routeFromHash` у `App.tsx` уже вважає її сторінкою заявок. Кнопка «Підготовка до співбесіди» в редакторі заявки й посилання в рядку списку заявок, якщо статус `sent`, `submitted`, `interview` або збережена підготовка існує (перегляд).

Картки: варіант B зі специфікації, сітка з `KindArt` (вбудований SVG за видом, без мережі, без фото), для `practice` із кодом замість малюнка `<pre>`, текст запитання, стан. Над сіткою: вакансія, «Пройдено N із 9», мова, «Продовжити». Під сіткою блок 3 запитань до роботодавця лише для читання. Перед першим створенням: вибір мови з `defaultLanguage`. У режимі `readOnly` без дій зміни й із приміткою.

- [ ] **Step 1: Написати тести, що падають**

Кнопка є для `sent`, немає для `draft`. Без набору показано вибір мови, після старту 9 карток і «Пройдено 0 із 9». Лічильник рахує лише запитання із зауваженнями; `pending` не рахується. Запитання до роботодавця не в лічильнику. `practice` з кодом показує `<pre>`. `readOnly`: немає «Продовжити». Помилка завантаження → `ErrorBanner`.

- [ ] **Step 2: Запустити й побачити падіння**

Run: `npm test -w web -- InterviewPage`
Expected: FAIL.

- [ ] **Step 3: Реалізувати сторінку й тексти 6 мовами**

- [ ] **Step 4: Перевірити**

Run: `npm test -w web -- InterviewPage ApplicationsPage ApplicationEditor; npm run i18n:check`
Expected: PASS.

- [ ] **Step 5: Коміт**

`git add web && git commit -m "feat(interview): entry and question cards"`

### Task 6: Відповідь і зауваження

**Files:**
- Create: `web/src/interview/AnswerView.tsx`, `web/src/interview/FeedbackView.tsx`, `web/src/interview/AnswerView.test.tsx`
- Modify: `web/src/interview/InterviewPage.tsx`, `web/src/styles.css`, `web/src/locales/*.json`

**Interfaces:**
- Consumes: `api.answerInterview`, `questionState`.
- Produces: компонент `AnswerView` з місцем під майбутню кнопку голосу: він приймає `extraActions?: ReactNode`, у цій версії порожній.

Послідовність зі специфікації 5.3–5.4: запитання без підказок, поле тексту, «Отримати зауваження», «Не знаю». Під час очікування — наявний `ClaudeWorking` зі скасуванням через `signal`. Зауваження: три блоки з заголовками «Слабке за змістом», «Помилки в мові», «Як сказати краще»; «Спробувати ще раз» (поле заповнене попередньою відповіддю), «Далі». Незбережений текст реєструється через `useReportUnsaved`.

- [ ] **Step 1: Написати тести, що падають**

Запитання показано, підказок немає. «Отримати зауваження» неактивна при порожньому полі; лічильник 5 000 не дає більше. «Не знаю» надсилає `{ text: '', dontKnow: true }`. Показано всі три блоки; порожній список виправлень показує «Мовних помилок не знайдено». `LLM_LIMIT` → зрозуміле повідомлення, текст у полі лишається. `pending`-запитання відкривається зі збереженим текстом. Набраний текст запускає попередження про незбережене.

- [ ] **Step 2: Запустити й побачити падіння**

Run: `npm test -w web -- AnswerView`
Expected: FAIL.

- [ ] **Step 3: Реалізувати**

- [ ] **Step 4: Перевірити**

Run: `npm test -w web -- AnswerView InterviewPage; npm run i18n:check`
Expected: PASS.

- [ ] **Step 5: Коміт**

`git add web && git commit -m "feat(interview): answering and feedback"`

### Task 7: Підсумок і нові запитання

**Files:**
- Create: `web/src/interview/SummaryView.tsx`, `web/src/interview/SummaryView.test.tsx`
- Modify: `web/src/interview/InterviewPage.tsx`, `web/src/styles.css`, `web/src/locales/*.json`

**Interfaces:**
- Consumes: `api.interviewSummary`, `api.startInterview(..., true)`.

Після останнього зауваження автоматично викликається підсумок. Склад екрана зі специфікації 5.5. Напис біля цифри дослівно (uk): «Приблизна оцінка ШІ лише за твоїми відповідями тут. Вона не знає інших кандидатів і рішення фірми, тому це не обіцянка й не прогноз результату.» Формат «≈ 60%», поруч попереднє значення, якщо є. «Нові запитання» й зміна мови спершу просять підтвердження в наявному стилі вікон програми, без `window.confirm`.

- [ ] **Step 1: Написати тести, що падають**

Цифра з «≈» і написом ніколи не показується без напису. До кінця набору цифри немає, є лише прогрес. Показано чотири напрями й ризик; посилання ризику веде на запитання. «Повторити» біля слабкого відкриває його. Після повторення показано старе й нове значення. Скасування підтвердження «Нові запитання» нічого не змінює, підтвердження кличе `replace: true`. Помилка підсумку: зроблене лишається, є «Спробувати ще раз».

- [ ] **Step 2: Запустити й побачити падіння**

Run: `npm test -w web -- SummaryView`
Expected: FAIL.

- [ ] **Step 3: Реалізувати**

- [ ] **Step 4: Перевірити**

Run: `npm test -w web; npm run i18n:check`
Expected: PASS.

- [ ] **Step 5: Коміт**

`git add web && git commit -m "feat(interview): summary with chance figure"`

### Task 8: Інструмент перевірки голосу вдома

Це не частина програми й не входить у реліз.

**Files:**
- Create: `scripts/check-voice.mjs`, `scripts/check-voice.html`
- Modify: кореневий `package.json` (`"check:voice": "node scripts/check-voice.mjs"`), `scripts/release.mjs` лише якщо він збирає всю теку `scripts/`

**Interfaces:** немає.

`npm run check:voice` піднімає сервер лише на `127.0.0.1` на вільному порту, друкує адресу. Сторінка: попередження, що браузер, найімовірніше, передає голос Microsoft або Google, вибір `de-DE`/`en-US`, «Почати» й «Стоп», поточний і кінцевий текст, рядок із `event.error`, ім'я браузера. Нічого не зберігає й не надсилає сама.

- [ ] **Step 1: Реалізувати**

- [ ] **Step 2: Перевірити без мікрофона**

Run: `npm run check:voice`, відкрити адресу в Edge і Chrome.
Expected: сторінка відкривається; на цьому ПК без мікрофона показано зрозумілу помилку, а не порожнечу. У релізному архіві цих файлів немає: `npm run release`, перелік архіву.

- [ ] **Step 3: Коміт**

`git add scripts package.json && git commit -m "chore: voice check page for testing at home"`

### Task 9: e2e, документи, версія

**Files:**
- Modify: `e2e/app.spec.ts`, `README.md`, `docs/privacy.html`, `CHANGELOG.md`, `package.json`, `server/package.json`, `web/package.json`, `package-lock.json`

**Interfaces:**
- Consumes: фальшиві відповіді із задачі 3 (коротка відповідь = слабка).

- [ ] **Step 1: Написати e2e-сценарій**

Тест `interview preparation: questions, feedback, summary, repeat`: відправлена заявка із наявного сценарію → кнопка → старт → 9 відповідей, з них 2 короткі → «≈ 70%» і напис поруч → 2 у «Ще слабке» → повторити одне довгою відповіддю → цифра вища, старе значення видно. У кінці файл `package.json` цієї заявки має той самий `updatedAt`.

- [ ] **Step 2: Запустити**

Run: `npm run e2e`
Expected: PASS усіх сценаріїв.

- [ ] **Step 3: Документи й версія 0.12.0**

`privacy.html`: відповіді й вакансія йдуть вибраному ШІ-помічнику, зберігаються на ПК. Про голос цієї версії нічого, бо голосу немає. `README`: короткий абзац. `CHANGELOG`: людською мовою.

- [ ] **Step 4: Повна перевірка**

Run: `npm run typecheck; npm run lint; npm test; npm run i18n:check; npm audit --omit=dev; npm run build`
Expected: помилок немає; audit показує лише вже відомі Роберту 3 moderate або менше.

- [ ] **Step 5: Коміт**

`git add -A && git commit -m "feat: interview preparation 0.12.0"`

## Після задач

1. Фінальне рев'ю (opus) усієї гілки, хвиля виправлень.
2. Приймальна перевірка з Робертом на справжній заявці, на окремій копії даних: зміст зауважень, немає вигаданого досвіду, слабкі відповіді справді дають нижчу цифру, світла й темна тема.
3. `bp-release`: дві зупинки на «так». Заодно перший справжній запуск «Оновити зараз» на цьому ПК з 0.11.0 (і перевірка з відкритим демо), бо він усе одно чекав на наступну версію. Dependabot #13/#14 і glob/minimatch вирішує Роберт окремо перед релізом.
4. Вдома: Роберт запускає `npm run check:voice`. За результатом — окремий короткий план голосу (розділ 9 специфікації).
