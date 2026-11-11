# Контакт і дослідження фірми з будь-якого посилання (0.13.0): план реалізації

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** з посилання на вакансію з будь-якого сайту програма сама знаходить контакт і сайт фірми (переходячи за посиланнями), складає блок «Про фірму» з джерелами, а лист може використати 1–2 факти.

**Architecture:** новий модуль `server/src/research/` — чисті функції (вибір посилань, визначення сайту, злиття контакту, розбір RSS), конвеєр `collect` (захищений браузер на кілька сторінок + Google News через закріплений HTTPS-завантажувач) і черга `ResearchJob` (одне дослідження за раз). ШІ лише підсумовує зібраний текст (нова задача `company-research`), сервер відкидає пункти без наданого джерела. Вакансії v5 (`research`, `contactAuto`), пакет v7 (`vacancy.facts`, `vacancy.contactAuto`). Веб: блок у картці вакансії, попередження про авто-пошту, примітка про нові факти.

**Tech Stack:** Fastify, puppeteer-core (наявний), `node:https` (наявний закріплений `get` з `pdf-fetch.ts`), React, vitest, Playwright. Нових бібліотек немає.

**Spec:** `docs/superpowers/specs/2026-11-11-bewerbungspilot-company-research-design.md`

## Global Constraints

- Жодних нових залежностей.
- ШІ-помічник лишається ізольованим (без інтернету/файлів): шукає й читає лише програма.
- Назовні йде лише назва фірми (Google News) і адреси сторінок фірми; жодних даних людини.
- Одне дослідження: ≤ 6 прочитаних сторінок, ≤ 60 с (без часу ШІ), один браузер на все дослідження; одне дослідження за раз, решта — черга.
- Правила безпеки 0.8.3 без змін: кожна сторінка й запит через `checkPublicUrl`/`allowRequest`, `LOCKDOWN_SCRIPT`, тимчасовий профіль, без картинок/завантажень; без логінів у посиланнях.
- Google News: лише `https://news.google.com/rss/search`, ≤ 1 МБ, 10 с, лише заголовок/дата/джерело/посилання, ~6 місяців, ≤ 10 записів у вхід ШІ, ≤ 5 у блоці.
- Кожен факт/прапорець/новина має джерело з наданих; без джерела пункт відкидається. «Нічого не знайдено» — явно.
- Червоні прапорці ніколи не йдуть у лист.
- Заповнене поле контакту ніколи не перезаписується автоматично; авто-заповнені поля позначені (`contactAuto`) і не входять у `allowedFor`.
- Відправка на авто-знайдену пошту не блокується; жовте попередження «Адресу знайдено автоматично на <домен> — перевір, що це фірма», доки контакт не підтверджено.
- Додавання вакансії не чекає дослідження; створення пакета не чекає дослідження.
- Тексти сторінок не зберігаються (лише підсумок і адреси джерел). У лог — лише хост і результат.
- Kununu/Glassdoor/LinkedIn/Xing не читаються автоматично; Kununu — лише посилання для людини.
- Усі тексти в 6 мовах (`npm run i18n:check`): uk/de/ru/ro на «ви», pl на «ти», `{{ai}}` замість назви помічника. Світла/темна тема, 390 px без горизонтальної прокрутки.

## Review Focus

1. Вакансія видалена/прихована чи програма вимкнена посеред дослідження → дослідження зупиняється, нічого не пише в зниклу картку; після перезапуску стан `running`/`queued` стає `failed` (кнопка «Дослідити ще раз»), а не вічне «Досліджую». Тести — задача 8.
2. Пошта самої дошки (`service@stepstone.de`, `info@itsax.de`, `privacy@…`) чи Google/Cloudflare на сторінці вакансії → не береться за контакт фірми; пошта з домену дошки відкидається, якщо дошка ≠ сайт фірми. Тест — задача 4.
3. Порожня, загальна чи агентська назва фірми («Personalvermittlung», «Arbeitgeber», < 3 літер) → без здогаду домену й без запиту новин, а не дослідження чужої фірми. Тест — задача 3 і 5.
4. Сторінка з десятками `mailto:`/`tel:` (каталог, футер групи фірм) → беруться не більше 5 адрес, пріоритет — сторінка вакансії/заявки, не перша-ліпша. Тест — задача 4.
5. ШІ повертає факт з джерелом, якого не було серед наданих, чи вигадану новину → пункт відкидається; якщо відкинуто все — блок показує «не знайдено», а не порожнечу. Тест — задача 7.

---

### Задача 1: Типи й схеми (вакансії v5, пакет v7)

**Files:**
- Modify: `shared/types/vacancy.d.ts`, `shared/types/application.d.ts`
- Modify: `server/src/vacancies/schema.ts` (версія 5, міграція 4→5, валідація), `server/src/applications/schema.ts` (`PACKAGE_SCHEMA_VERSION = 7`, міграція 6→7)
- Test: `server/src/vacancies/schema.test.ts`, `server/src/applications/schema.test.ts` (наявні — дописати)

**Interfaces:**
- Produces (у `shared/types/vacancy.d.ts`):
  - `type ContactField = 'email' | 'salutation' | 'name' | 'phone' | 'street' | 'postcode' | 'city'`
  - `type ResearchState = 'queued' | 'running' | 'done' | 'failed'`
  - `interface ResearchSource { url: string; kind: 'vacancy' | 'impressum' | 'contact' | 'apply' | 'careers' | 'about' | 'home' | 'news' }`
  - `interface ResearchNews { title: string; date: string /* YYYY-MM-DD */; source: string; url: string }`
  - `interface ResearchPoint { id: string; text: string; sourceUrl: string; hidden?: boolean }`
  - `interface CompanyResearch { state: ResearchState; startedAt: string | null; finishedAt: string | null; provider: ProviderId | null; language: Language | null; website: string /* '' = не знайдено */; websiteByPerson: boolean; about: string; news: ResearchNews[]; newsFailed: boolean; redFlags: ResearchPoint[]; facts: ResearchPoint[]; sources: ResearchSource[]; error: ErrorCode | null }`
  - `Vacancy` + `research?: CompanyResearch` + `contactAuto?: ContactField[]`
  - `PackageVacancy` + `facts?: string[]` + `contactAuto?: ContactField[]`
- Ліміти в `VACANCY_LIMITS`: `researchAbout: 600`, `researchPoint: 300`, `researchNews: 5`, `researchPoints: 3`, `researchUrl: 2000`.

- [ ] **Step 1: Тести**: `'v4 file migrates to v5 without changing any vacancy'` (глибока рівність полів), `'v5 accepts research and contactAuto, rejects unknown fields and >3 facts'`, `'package v6 migrates to v7 unchanged; v7 accepts vacancy.facts (≤3 strings) and contactAuto'`.
- [ ] **Step 2:** `npm test -w server -- schema` → FAIL (версія 4/6).
- [ ] **Step 3:** версії, міграції (нічого не додають), схеми JSON (`additionalProperties: false`) за типами вище.
- [ ] **Step 4:** `npm test -w server -- schema` → PASS; `npm run typecheck` → без помилок.
- [ ] **Step 5:** commit `feat: vacancy v5 (research, contactAuto) and package v7 (facts)`.

### Задача 2: Читач сторінок повертає посилання і працює сесією

**Files:**
- Modify: `server/src/vacancies/sources/page-reader.ts`
- Test: `server/src/vacancies/sources/page-reader.test.ts`

**Interfaces:**
- Produces:
  - `interface PageLink { text: string; href: string }` (абсолютні `http(s)`, `mailto:`, `tel:`; ≤ 300 посилань, текст ≤ 80 символів)
  - `interface PageRead { url: string /* після переадресацій */; text: string; links: PageLink[] }`
  - `PageReader.session(signal: AbortSignal, deadlineMs: number): Promise<ReadSession>`
  - `interface ReadSession { open(url: string): Promise<PageRead>; close(): Promise<void> }` — один браузер і тимчасовий профіль на сесію; кожен `open` — нова вкладка з тими самими фільтрами, `LOCKDOWN_SCRIPT`, перевіркою внутрішньої адреси; час `open` ≤ залишку до `deadlineMs`; після дедлайну — `pageUnreadable` `timeout`.
  - `read(url, signal)` лишається (реалізується через сесію з одним `open`), поведінка й логи без змін.

- [ ] **Step 1: Тести** (фальшивий `launch`, як у наявних тестах): `'session reads two pages with one browser and deletes the profile once on close'`, `'links include mailto and tel, are absolute, capped at 300'`, `'a page answered from an internal address throws blocked and the session stays usable'`, `'open after the deadline throws pageUnreadable timeout'`, наявні тести `read` — без змін і зелені.
- [ ] **Step 2:** `npm test -w server -- page-reader` → FAIL.
- [ ] **Step 3:** реалізація; посилання збираються в `page.evaluate` з `a[href]` (`href` уже абсолютний у DOM).
- [ ] **Step 4:** тест → PASS.
- [ ] **Step 5:** commit `feat: page reader sessions with links`.

### Задача 3: Вибір посилань і сайту фірми (чисті функції)

**Files:**
- Create: `server/src/research/links.ts`
- Test: `server/src/research/links.test.ts`

**Interfaces:**
- Produces:
  - `const APPLY_SERVICES: string[]` — суфікси хостів сервісів заявок: `jobs.personio.de`, `personio.de`, `softgarden.io`, `softgarden.de`, `myworkdayjobs.com`, `smartrecruiters.com`, `greenhouse.io`, `lever.co`, `empfehlungsbund.de`, `dvinci-hr.com`, `onlyfy.jobs`, `join.com`, `recruitee.com`, `jobs.hw.ag`-подібні не вносити (це сайт фірми).
  - `const JOB_BOARDS: string[]` — `stepstone.de`, `indeed.com`, `indeed.de`, `itsax.de`, `get-in-it.de`, `remotely.de`, `jobvector.de`, `jobijoba.de`, `jooble.org`, `jobleads.com`, `wearedevelopers.com`, `xing.com`, `linkedin.com`, `arbeitsagentur.de`, `monster.de`, `kimeta.de`.
  - `const IGNORED_HOSTS: string[]` — соцмережі, карти, шрифти, лічильники, `google.*`, `apple.com`, `play.google.com`, `cookiebot.com`, `usercentrics.eu`, `youtube.com`, `facebook.com`, `instagram.com`, `twitter.com`, `x.com`, `kununu.com`, `glassdoor.*`.
  - `const FREE_MAIL: string[]` — `gmail.com`, `googlemail.com`, `gmx.de`, `gmx.net`, `web.de`, `t-online.de`, `outlook.com`, `hotmail.com`, `yahoo.com`, `yahoo.de`, `icloud.com`, `posteo.de`, `mail.de`, `freenet.de`.
  - `type PageKind = ResearchSource['kind']`
  - `pageKind(link: PageLink): PageKind | null` — за текстом/адресою (de/en): `impressum|imprint|legal notice` → impressum; `kontakt|contact` → contact; `bewerb|apply|jetzt bewerben` → apply; `karriere|career|jobs|stellen` → careers; `über uns|ueber-uns|about|unternehmen` → about.
  - `isBoard(host: string): boolean`, `isApplyService(host: string): boolean`, `isIgnored(host: string): boolean`, `siteOf(url: string): string` (`https://host` без `www.` у порівнянні).
  - `websiteCandidates(input: { pageUrl: string; links: PageLink[]; emails: string[]; company: string }): string[]` — порядок специфікації 4.2 пункт 2.1–2.4 (посилання з дошки на інший не ігнорований хост; домен не безкоштовної пошти; сама сторінка, якщо не дошка й не сервіс; здогади `https://www.<slug>.de`, `.com`, з дефісом і без), без повторів, ≤ 6.
  - `companySlugs(company: string): string[]` — без правової форми (`GmbH & Co. KG`, `GmbH`, `AG`, `SE`, `KG`, `UG (haftungsbeschränkt)`, `e.V.`, `mbH`), умлаути `ä→ae…`, лише `[a-z0-9-]`; `[]` для назви < 3 літер чи загальної (`personalvermittlung`, `arbeitgeber`, `unternehmen`, `firma`, `anonym`, `vertraulich`).
  - `nameOnPage(company: string, text: string): boolean` — назва без правової форми є в тексті (без регістру, пробіли згорнуті).
  - `nextPages(site: string, links: PageLink[], seen: Set<string>): Array<{ url: string; kind: PageKind }>` — лише той самий сайт або сервіс заявок, без `mailto/tel`, порядок: impressum → contact → apply → careers → about.

- [ ] **Step 1: Тести** з реальними формами з розвідки: ITsax-сторінка з посиланням на `https://www.symate.de/jobs` → кандидат `https://www.symate.de`; StepStone без зовнішніх посилань, пошти немає, фірма «iSAX GmbH & Co. KG» → `['https://www.isax.de', 'https://www.isax.com']`; пошта `jobs@helmundwalter.de` → `https://helmundwalter.de`; пошта `x@gmail.com` → не кандидат; `companySlugs('Personalvermittlung')` → `[]`; `pageKind({text:'Impressum', href:'…/impressum'})` → `'impressum'`; `nextPages` відкидає `facebook.com`, бере `jobs.personio.de` як apply.
- [ ] **Step 2:** `npm test -w server -- research/links` → FAIL.
- [ ] **Step 3:** реалізація.
- [ ] **Step 4:** → PASS.
- [ ] **Step 5:** commit `feat: research link picking and company website candidates`.

### Задача 4: Контакт зі сторінок і злиття без перезапису

**Files:**
- Create: `server/src/research/contact-merge.ts`
- Test: `server/src/research/contact-merge.test.ts`

**Interfaces:**
- Consumes: `parseContact(text)` (`vacancies/contact-parse.ts`), `PageLink`, `isBoard`, `siteOf`.
- Produces:
  - `interface FoundPage { url: string; kind: PageKind; text: string; links: PageLink[] }`
  - `contactFromPages(pages: FoundPage[], site: string): VacancyContact` — пріоритет сторінок `vacancy`, `apply` → `contact` → `impressum` → інші; пошта: спершу `mailto:` з посилань, потім текст; не більше 5 кандидатів пошти/телефону на сторінку; відкидаються пошти з домену дошки (`isBoard`), якщо `siteOf(page) !== site`, і `privacy@|datenschutz@|noreply@|webmaster@`; для пошти з однаковим пріоритетом перевага `bewerbung|jobs|karriere|career|hr|personal` над `info|kontakt`.
  - `mergeContact(current: VacancyContact | null, found: VacancyContact, auto: ContactField[] | undefined): { contact: VacancyContact | null; auto: ContactField[]; differing: Partial<VacancyContact> }` — лише порожні поля заповнюються й додаються в `auto`; заповнені не змінюються, різне значення — у `differing`; `salutation` заповнюється лише разом з іменем.

- [ ] **Step 1: Тести**: `'never overwrites a filled field; differing lists the other value'`, `'fills only empty fields and marks them auto'`, `'mailto on the apply page wins over info@ in the Impressum'` (з даними Helm & Walter: `jobs@helmundwalter.de` > `info@helmundwalter.de`), `'board e-mail (service@stepstone.de) is not taken'`, `'a page with 40 mailto links yields at most 5 candidates and picks the apply one'`.
- [ ] **Step 2:** → FAIL. **Step 3:** реалізація. **Step 4:** → PASS.
- [ ] **Step 5:** commit `feat: research contact from pages and merge without overwriting`.

### Задача 5: Новини з Google News RSS

**Files:**
- Create: `server/src/vacancies/sources/safe-get.ts` (винесено з `pdf-fetch.ts`: закріплений `lookup`, `get`, перевірка кожної переадресації, ліміт байтів і часу)
- Modify: `server/src/vacancies/sources/pdf-fetch.ts` (використовує `safe-get.ts`, поведінка й тести без змін)
- Create: `server/src/research/news.ts`
- Test: `server/src/research/news.test.ts`, наявні `pdf-fetch.test.ts` зелені

**Interfaces:**
- Produces:
  - `safeGetBytes(url: string, opts: { maxBytes: number; timeoutMs: number; signal: AbortSignal; check?: Check; lookup?: Lookup }): Promise<Uint8Array>` (кидає `SafeGetError(why: 'blocked'|'timeout'|'tooBig'|'status'|'network')`)
  - `newsQueryUrl(company: string): string | null` — `https://news.google.com/rss/search?q=%22<назва без правової форми>%22+when:180d&hl=de&gl=DE&ceid=DE:de`; `null`, якщо `companySlugs(company)` порожній.
  - `parseNewsRss(xml: string, now: Date): ResearchNews[]` — `<item>`: `title`, `pubDate` → `YYYY-MM-DD`, `source`, `link`; лише ≤ 180 днів, новіші перші, ≤ 10; без XML-бібліотеки (регулярні вирази по `<item>`, декодування `&amp; &lt; &gt; &quot; &#39;` і CDATA).
  - `fetchNews(company: string, signal: AbortSignal, get?: typeof safeGetBytes): Promise<ResearchNews[] | null>` — `null` = не вдалося (не кидає, крім скасування); ≤ 1 МБ, 10 с; хост лише `news.google.com`.

- [ ] **Step 1: Тести**: `'parses a Google News RSS fixture: titles, dates, source, newest first, older than 180 days dropped'` (фікстура в тесті, 3 записи), `'entities and CDATA are decoded'`, `'generic company name → no request'`, `'network error → null, cancel → LLM_CANCELLED'`.
- [ ] **Step 2:** → FAIL. **Step 3:** реалізація (спершу винести `safe-get.ts`, прогнати `pdf-fetch` тести). **Step 4:** → PASS.
- [ ] **Step 5:** commit `feat: company news from Google News RSS through the pinned fetcher`.

### Задача 6: Конвеєр `collect`

**Files:**
- Create: `server/src/research/collect.ts`
- Test: `server/src/research/collect.test.ts`

**Interfaces:**
- Consumes: `PageReader.session`, задачі 3–5.
- Produces:
  - `type CollectMode = 'contact' | 'full'`
  - `interface CollectInput { vacancyUrl: string /* '' для тексту */; partnerUrl: string; company: string; websiteHint: string /* вставлений людиною сайт або '' */; skipVacancyPage: boolean /* AA */ }`
  - `interface Collected { website: string; pages: FoundPage[]; contact: VacancyContact; news: ResearchNews[] | null; sources: ResearchSource[] }`
  - `collect(input: CollectInput, mode: CollectMode, deps: { reader: PageReader; fetchNews: typeof fetchNews; now: () => Date }, signal: AbortSignal): Promise<Collected>`
  - Константи: `MAX_PAGES = 6`, `COLLECT_BUDGET_MS = 60_000`.
- Алгоритм (рішення, яке тест не визначає): прочитати сторінку вакансії (якщо є й не `skipVacancyPage`; інакше `partnerUrl`, якщо не AA) → `websiteHint` або перший кандидат `websiteCandidates`, для здогаду (пункт 2.4) відкрити головну й прийняти лише при `nameOnPage` → `nextPages` до ліміту → у режимі `full` паралельно `fetchNews`. Нечитабельна сторінка пропускається й не рахується як помилка дослідження. Сесія закривається завжди.

- [ ] **Step 1: Тести** (фальшивий `PageReader` зі словником URL→`PageRead`): `'ITsax → company site → Impressum: contact filled, 3 pages read'`, `'never more than 6 pages, stops at 60 s budget'` (фальшивий годинник), `'guessed domain without the company name on the page is rejected → website empty'`, `'contact mode does not fetch news'`, `'an unreadable vacancy page still searches the website by name'`, `'abort closes the session'`.
- [ ] **Step 2:** → FAIL. **Step 3:** реалізація. **Step 4:** → PASS.
- [ ] **Step 5:** commit `feat: research collect pipeline`.

### Задача 7: ШІ-задача `company-research`

**Files:**
- Create: `server/src/research/task.ts`
- Modify: `server/src/llm/types.ts` (`LLM_TASK_IDS` + `'company-research'`), `server/src/llm/fake-scripted.ts` (відповідь)
- Test: `server/src/research/task.test.ts`; наявний тест повноти фальшивих відповідей має пройти

**Interfaces:**
- Produces:
  - `interface ResearchOutput { about: string; news: number[] /* індекси наданих новин */; redFlags: { text: string; source: number }[]; facts: { text: string; source: number }[] }` (сувора схема OpenAI: усі поля `required`, `additionalProperties: false`)
  - `companyResearchTask(company: string, c: Collected, language: Language): LlmTask` — джерела нумеруються (сторінки, потім новини); тексти сторінок через `fenceUntrusted`, разом ≤ 30 000 символів, порядок пріоритету impressum, about, home, apply, contact, careers, vacancy; правила: лише з наданого, `facts` — конкретні й придатні для речення «чому саме ця фірма», не про зарплату чи переваги для працівника; `redFlags` — лише конкретні події (звільнення, банкрутство, судові справи, масові скорочення), не здогади; мова відповіді — `language`.
  - `toResearch(out: ResearchOutput, c: Collected, meta: { provider: ProviderId; language: Language; startedAt: string; now: string }): CompanyResearch` — відкидає пункти з неіснуючим індексом, обрізає до лімітів задачі 1, `id` = `crypto.randomUUID()`, ≤ 3 факти/прапорці, ≤ 5 новин.

- [ ] **Step 1: Тести**: `'a fact with a source index not given is dropped'`, `'all points dropped → empty arrays, about kept'`, `'news are taken only from the collected list by index'`, `'prompt contains no person data and fences page text'`, `'texts over 30 000 characters are cut, Impressum kept'`.
- [ ] **Step 2:** → FAIL. **Step 3:** реалізація + фальшива відповідь (1 факт, 0 прапорців, `about`). **Step 4:** → PASS (включно з `fake-scripted` тестом).
- [ ] **Step 5:** commit `feat: company-research AI task with source checks`.

### Задача 8: Черга досліджень і API

**Files:**
- Create: `server/src/research/job.ts`, `server/src/research/routes.ts`
- Modify: `server/src/app.ts` (підключення; `browserWork` для сесій), `server/src/vacancies/routes.ts` (запуск після `POST /api/vacancies/manual`; «Знайти контакт» не-AA і AA-«лише посилання» через `collect(…,'contact')`), `server/src/vacancies/contact-find.ts`, `server/src/vacancies/store.ts` (при завантаженні `running|queued` → `failed`), `PUT /api/vacancies/:id/contact` очищає `contactAuto`
- Test: `server/src/research/job.test.ts`, `server/src/research/routes.test.ts`, наявні тести контакту

**Interfaces:**
- Consumes: задачі 4, 6, 7; `LlmQueue.runTagged`; `Activity.begin('browser')`.
- Produces:
  - `class ResearchJob { enqueue(vacancyId: string): void; cancel(vacancyId: string): void; busy(): boolean }` — одне за раз; записує `research.state` (`queued` → `running` → `done|failed`) і результат, лише якщо вакансія ще існує й не прихована; контакт застосовується через `mergeContact` (вакансія `contact`/`contactAuto`).
  - Маршрути: `POST /api/vacancies/:id/research` (202, у черзі), `DELETE /api/vacancies/:id/research` (зупинити), `PATCH /api/vacancies/:id/research/facts/:factId` тіло `{ hidden: boolean }`, `PUT /api/vacancies/:id/research/website` тіло `{ url: string }` (http(s), `checkPublicUrl` без DNS, → `websiteByPerson: true`, нове дослідження).
  - `POST /api/vacancies/:id/contact/find` для не-AA: відповідь `ContactProposal` + `differing` (поле `differing?: Partial<VacancyContact>` у `ContactProposal`).
  - Вхід `collect` для вакансії: `vacancyUrl = url` (для AA — `''`, `skipVacancyPage: true`), `partnerUrl`, `company`, `websiteHint = research?.websiteByPerson ? research.website : ''`; режим `full` для дослідження, `contact` для «Знайти контакт».
  - Автозапуск: після успішного `POST /api/vacancies/manual` (і для посилання AA) — `enqueue`; не для вставленого тексту без назви фірми.
  - Під час дослідження `updates/apply` і відновлення копії отримують `busy` `browser` (через `Activity`).

- [ ] **Step 1: Тести**: `'manual add returns at once and enqueues research'`, `'two enqueues run one after another'`, `'hidden or deleted vacancy during research → nothing written'`, `'restart: running/queued becomes failed'`, `'filled contact stays, empty fields filled and marked auto; PUT contact clears contactAuto'`, `'find contact on a non-AA card returns a proposal and differing, writes nothing'`, `'PATCH fact hidden is kept after a re-research only for the same text'` (новий запуск — нові факти, `hidden` не переноситься; тест фіксує саме це), `'PUT website with an internal address → 400'`.
- [ ] **Step 2:** → FAIL. **Step 3:** реалізація. **Step 4:** `npm test -w server` → PASS.
- [ ] **Step 5:** commit `feat: research queue, API and automatic start for pasted links`.

### Задача 9: Пакет: факти в листі, авто-контакт

**Files:**
- Modify: `server/src/applications/snapshot.ts` або місце, де будується `PackageVacancy` (копіює `facts` = тексти неприбраних фактів і `contactAuto`), `server/src/applications/tasks/create-package.ts` (`offerBlock` додає блок фактів; правило в `letterRules`), `server/src/applications/views.ts` (`factsChanged: boolean`), `server/src/applications/personal-data.ts` (`allowedFor` не бере авто-поля), `server/src/applications/routes.ts` (`PUT /api/applications/:id/contact` очищає `contactAuto`; «Створити знову» бере поточні факти)
- Test: відповідні наявні `*.test.ts` + нові кейси

**Interfaces:**
- Consumes: `Vacancy.research.facts`, `Vacancy.contactAuto`.
- Produces: `ApplicationView.factsChanged: boolean` (знімок ≠ поточні неприбрані факти вакансії); `ApplicationView.recipientAuto: { domain: string } | null` (пошта отримувача в `contactAuto` пакета → домен пошти).
- Правило для `letterRules` (дослівно): `"Facts about the company (optional): you may use one or two of them for a concrete "why this company" sentence. Use only these facts, never invent others, never mention anything negative about the company."` Факти — через `fenceUntrusted('company facts', …)`.

- [ ] **Step 1: Тести**: `'create package snapshots non-hidden facts only; red flags never reach the prompt'`, `'revise uses the snapshot facts; create again takes the current ones'`, `'factsChanged true when research finished after the package'`, `'auto e-mail is not allowed in allowedFor until confirmed'`, `'recipientAuto shows the domain; PUT contact clears it'`, `'no research → prompt has no facts block'`.
- [ ] **Step 2:** → FAIL. **Step 3:** реалізація. **Step 4:** `npm test -w server` → PASS.
- [ ] **Step 5:** commit `feat: company facts in the letter and auto contact in packages`.

### Задача 10: Веб — блок «Про фірму» в картці вакансії

**Files:**
- Create: `web/src/vacancies/CompanyBlock.tsx`, `web/src/vacancies/CompanyBlock.test.tsx`
- Modify: `web/src/vacancies/VacancyCard.tsx`, `web/src/api.ts`, `web/src/types.ts`, `web/src/locales/*.json`, `web/src/styles.css`

**Interfaces:**
- Consumes: маршрути задачі 8, `Vacancy.research`.
- Produces: `CompanyBlock({ vacancy, onChange }: { vacancy: Vacancy; onChange: (v: Vacancy) => void })`; `api.startResearch(id)`, `api.stopResearch(id)`, `api.hideFact(id, factId, hidden)`, `api.setResearchWebsite(id, url)`.
- Вигляд за спеком 3.1: розгорний блок (`details`), стани «Досліджую фірму…» + «Зупинити», «У черзі», кнопка «Дослідити фірму» (немає `research`), «Дослідити ще раз»; підрозділи «Сайт», «Чим займається», «Що нового», «Варто знати» з позначкою «лише для вас, у лист не йде» і посиланням «Відгуки на Kununu» (`https://www.kununu.com/de/search?q=<назва>`, нова вкладка, `rel="noopener noreferrer"`), «Факти для листа» з хрестиком; «Досліджено <дата> · Написав: <WrittenBy>»; «Сайт не знайдено» + поле адреси. Порожні підрозділи — «Нічого помітного не знайдено». Опитування стану кожні 2 с, поки `queued|running`.
- Позначка «знайдено автоматично — перевірте» біля авто-полів контакту в картці.

- [ ] **Step 1: Тести**: `'no research → Research company button calls the API'`, `'running shows progress and Stop'`, `'done shows sections, sources as links, Kununu link'`, `'hiding a fact calls PATCH and greys it out'`, `'website not found → field → PUT website'`, `'empty news → nothing notable found'`.
- [ ] **Step 2:** `npx vitest run src/vacancies` → FAIL. **Step 3:** реалізація + тексти 6 мов. **Step 4:** `npm test -w web` і `npm run i18n:check` → PASS.
- [ ] **Step 5:** commit `feat(web): company block on the vacancy card`.

### Задача 11: Веб — попередження, примітка про факти, «Знайдено інше»

**Files:**
- Modify: `web/src/applications/SendDialog.tsx`, `web/src/applications/MailDraftDialog.tsx`, `web/src/applications/OfferReplyDialog.tsx` (жовтий блок з `recipientAuto`), `web/src/applications/ApplicationEditor.tsx` (блок фактів знімка лише для читання + примітка `factsChanged` з кнопкою «Створити знову»), `web/src/applications/ContactDialog.tsx` (рядки `differing`: «Знайдено інше: … — Взяти»), locales, tests поруч

**Interfaces:**
- Consumes: `ApplicationView.recipientAuto`, `ApplicationView.factsChanged`, `PackageVacancy.facts`, `ContactProposal.differing`.

- [ ] **Step 1: Тести**: `'send dialog shows the auto-address warning with the domain and Send stays enabled'`, `'warning hidden when recipient differs from the auto e-mail or is confirmed'`, `'editor shows snapshot facts read-only and the new-facts notice'`, `'contact dialog: Take fills the field from differing'`.
- [ ] **Step 2:** → FAIL. **Step 3:** реалізація + 6 мов. **Step 4:** `npm test -w web`, `npm run i18n:check` → PASS.
- [ ] **Step 5:** commit `feat(web): auto-address warning, facts in the editor, take differing contact`.

### Задача 12: e2e, перевірка наживо, документи, версія 0.13.0

**Files:**
- Modify: `server/src/vacancies/sources/safe-address.ts` або місце створення читача — у тестовому режимі (той самий умовний вхід, що `devUpdateSourceAllowed`: `BP_DATA_DIR` + тестова пошта) дозволити `127.0.0.1` лише для порту фальшивої дошки з `BP_TEST_PAGES_PORT`; поза тестовим режимом змін немає (тест на це обов'язковий)
- Create: `e2e/fixtures/company-board/` (сторінка «дошки» з посиланням на «сайт фірми», Impressum, `mailto:`), `server/scripts/check-research.ts` (`npm run check:research -- <url>` — справжнє читання й підсумок у консоль, без збереження)
- Modify: `e2e/app.spec.ts`, `docs/privacy.html` (дата effective; читання сайтів фірм, Google News за назвою, Kununu лише посилання), `README.md`, `CHANGELOG.md`, версії 0.13.0 у `package.json`

- [ ] **Step 1:** e2e `'a pasted link from a board: company site and Impressum give the contact, the card shows facts, the letter uses a fact, a red flag never reaches the letter'` (з `--fake-llm`; фальшива відповідь `company-research` має факт і прапорець).
- [ ] **Step 2:** тест `'outside test mode 127.0.0.1 stays blocked even with BP_TEST_PAGES_PORT'`.
- [ ] **Step 3:** `npm test`, `npm run typecheck`, `npm run lint`, `npm run e2e` → усе зелене.
- [ ] **Step 4: Жива перевірка** (`npm run check:research`): ITsax Symate, ITsax Helm & Walter, StepStone iSAX, сторінка на Personio/softgarden, вакансія AA з «лише посиланням»; записати в журнал, що знайдено. Перевірити умови Google News RSS для некомерційної програми — висновок у журнал; якщо заборонено — `fetchNews` вимкнути прапорцем і зупинитись на рішення Роберта.
- [ ] **Step 5:** вигляд на демо-копії (світла/темна, 1280/390 px) — картка з блоком, вікно відправки з попередженням.
- [ ] **Step 6:** commit `chore: 0.13.0 — company research`.

---

Після задач: фінальне рев'ю всієї гілки (opus) → приймальна з Робертом → `bp-release`.
