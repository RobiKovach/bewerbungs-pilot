import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startApp, type E2eEnv } from './server';

// The whole app once, start to finish, as a person uses it (spec 0.9.0, 3.5). The steps build on each other,
// so they share one browser tab and run in order. AI answers are scripted (--fake-llm), mail goes to files
// (--fake-mail) and the update check reads a local version.json that announces 99.0.0.

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const env = JSON.parse(process.env.BP_E2E ?? '{}') as E2eEnv;
const mailDir = () => path.join(env.dataDir, 'tmp', 'fake-mail');

interface CloudRequest { method: string; url: string; body: string }

/** What the fake cloud service received, oldest first. */
function cloudRequests(): CloudRequest[] {
  if (!fs.existsSync(env.cloudLog)) return [];
  return fs.readFileSync(env.cloudLog, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as CloudRequest);
}

interface FakeMail { to: string; subject: string; attachments: { filename: string; size: number }[] }

/** Mails written by the fake mailer, oldest first (file names start with the time). */
function sentMails(): FakeMail[] {
  if (!fs.existsSync(mailDir())) return [];
  return fs.readdirSync(mailDir()).sort().map((f) => JSON.parse(fs.readFileSync(path.join(mailDir(), f), 'utf8')) as FakeMail);
}

test.describe.configure({ mode: 'serial' });

let context: BrowserContext;
let page: Page;
/** Text of every answer the app gave the page: none may contain the install number. */
const seenResponses: string[] = [];

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  context = await browser.newContext({ locale: 'en-US' });
  page = await context.newPage();
  page.on('response', (res) => {
    if (!res.url().startsWith(`${env.url}/api/`)) return;
    void res.text().then((t) => { seenResponses.push(t); }, () => undefined);
  });
});

test.afterAll(async () => {
  await context.close();
});

const next = () => page.getByRole('button', { name: 'Next', exact: true }).first();

async function openPersonalDetails(): Promise<void> {
  await page.getByRole('link', { name: 'Profile' }).first().click();
  const section = page.getByRole('heading', { name: 'Personal details' });
  await expect(section).toBeVisible();
  await page.getByRole('button', { name: 'Edit' }).first().click();
  await expect(page.getByRole('textbox', { name: 'Full name' })).toBeVisible();
}

test('welcome steps: AI helper, profile from a CV, stories, a document and the mailbox', async () => {
  await page.goto(`${env.url}/open?key=${encodeURIComponent(env.key)}`);
  await page.getByRole('button', { name: 'Next' }).click();

  // AI helper: the scripted Claude is ready at once.
  await page.getByRole('button', { name: 'Choose' }).first().click();
  await next().click();

  // Profile from the CV, every section confirmed.
  await page.locator('input[type=file]').first().setInputFiles(fixture('cv.pdf'));
  await expect(page.getByRole('heading', { name: 'Check your details' })).toBeVisible();
  const confirm = page.getByRole('button', { name: 'All correct' });
  await expect(confirm.first()).toBeVisible();
  const sections = await confirm.count();
  const checked = page.getByText('✓ Checked', { exact: true });
  for (let i = 0; i < sections; i++) {
    await confirm.nth(i).click();
    await expect(checked).toHaveCount(i + 1);
  }
  await next().click();

  // Stories for the cover letter.
  await page.getByRole('button', { name: 'Ask me questions' }).click();
  await page.getByRole('textbox', { name: 'Which project are you most proud of' })
    .fill('A website for a dental practice, built from a professional design template.');
  await page.getByRole('textbox', { name: 'How did you come to this profession?' })
    .fill('I taught myself with video courses and a lot of practice.');
  await page.getByRole('button', { name: 'Turn my answers into stories' }).click();
  const right = page.getByRole('button', { name: 'This is right' });
  await expect(right).toHaveCount(2);
  await right.first().click();
  await expect(right).toHaveCount(1);
  await right.first().click();
  await expect(right).toHaveCount(0);
  await next().click();

  // A document attached to every application: with the letter and the CV that makes three attachments.
  await page.getByRole('textbox', { name: 'Name of the new document' }).fill('Zeugnis Ausbildung');
  await page.getByRole('checkbox', { name: 'Attach to every application' }).check();
  await page.locator('input[type=file][accept=".pdf,application/pdf"]').setInputFiles(fixture('cv.pdf'));
  await expect(page.getByText('1 of 20 documents')).toBeVisible();
  await page.getByRole('button', { name: 'Finish' }).click();

  // Mailbox over SMTP; the test mail goes to a file.
  await page.getByRole('textbox', { name: 'Your email address' }).fill('max.mustermann@example.com');
  await page.getByRole('textbox', { name: 'Outgoing mail server (SMTP)' }).fill('smtp.example.com');
  await next().click();
  await page.getByRole('textbox', { name: /^Password/ }).fill('fake-app-password');
  await next().click();
  await page.getByRole('button', { name: 'Send a test email and save' }).click();
  await expect(page.getByText('Done! Check your inbox for the test email.')).toBeVisible();
  await expect.poll(() => sentMails().length).toBe(1);
  await next().click();
  await page.getByRole('button', { name: 'Finish' }).click();
  await expect(page.getByRole('link', { name: 'Job offers' }).first()).toBeVisible();
});

test('a pasted job offer becomes an approved application package', async () => {
  await page.getByRole('link', { name: 'Job offers' }).first().click();
  await page.getByRole('button', { name: '+ Add' }).click();
  await page.getByRole('textbox', { name: 'Text of the offer' }).fill(fs.readFileSync(fixture('vacancy.txt'), 'utf8'));
  await page.getByRole('button', { name: 'Add', exact: true }).click();

  const card = page.getByRole('article').filter({ hasText: 'Frontend-Entwickler' });
  await card.getByRole('button', { name: 'Save' }).click();
  await card.getByRole('button', { name: '★ Interesting' }).click();
  await page.getByRole('tab', { name: /Favourites/ }).click();
  await card.getByRole('button', { name: 'Create package' }).click();
  await card.getByRole('radio', { name: 'English' }).check();
  await card.getByRole('button', { name: 'Create' }).click();

  const approve = page.getByRole('button', { name: 'Approve' });
  await expect(approve).toBeEnabled({ timeout: 60_000 });
  await approve.click();
  await expect(page.getByRole('region', { name: 'History' }).getByRole('listitem').filter({ hasText: 'Approved' })).toBeVisible();
  const downloads = page.getByRole('group', { name: 'Download' });
  for (const name of ['Cover letter (PDF)', 'CV (PDF)', 'Zeugnis Ausbildung (PDF)', 'Everything as one PDF']) {
    await expect(downloads.getByRole('button', { name })).toBeVisible();
  }
});

test('the package is sent by mail and marked as sent', async () => {
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Send application' });
  const send = dialog.getByRole('button', { name: 'Send', exact: true });
  // The dialog prints the PDFs before it can show them.
  await expect(send).toBeEnabled({ timeout: 60_000 });
  await expect(dialog.getByRole('textbox', { name: "To (the employer's email address)" })).toHaveValue('hr@example.com');
  await send.click();

  await expect(page.getByText('Sent to hr@example.com — a copy is in your mailbox.')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('region', { name: 'History' }).getByRole('listitem').filter({ hasText: /Sent\s*to hr@example\.com/ })).toBeVisible();

  await expect.poll(() => sentMails().length).toBe(2);
  const mail = sentMails()[1];
  expect(mail.to).toBe('hr@example.com');
  expect(mail.subject).toContain('Frontend-Entwickler');
  expect(mail.attachments.length).toBeGreaterThanOrEqual(3);
  for (const a of mail.attachments) {
    expect(a.filename).toMatch(/\.pdf$/);
    expect(a.size).toBeGreaterThan(0);
  }
});

test('a backup brings the profile back', async () => {
  await page.getByRole('link', { name: 'Settings' }).first().click();
  await page.getByRole('button', { name: 'Save backup' }).click();
  await expect(page.getByText(/^Saved: /)).toBeVisible({ timeout: 30_000 });

  await openPersonalDetails();
  const fullName = page.getByRole('textbox', { name: 'Full name' });
  await fullName.fill('Erika Musterfrau');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();

  await page.getByRole('link', { name: 'Settings' }).first().click();
  const manual = page.getByRole('listitem').filter({ hasText: 'manual' });
  await expect(manual).toHaveCount(1);
  await manual.getByRole('button', { name: 'Restore' }).click();
  await page.getByRole('dialog', { name: 'Restore this backup?' }).getByRole('button', { name: 'Restore' }).click();
  await expect(page.getByText(/^Backup restored\./)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('listitem').filter({ hasText: 'before restore' })).toHaveCount(1);

  await openPersonalDetails();
  await expect(page.getByRole('textbox', { name: 'Full name' })).toHaveValue('Max Mustermann');
});

/** The folder of the only application that has a saved preparation, found by the file the preparation leaves there. */
function preparedApplicationFolder(): string | null {
  const walk = (dir: string): string | null => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'tmp') continue;
        const found = walk(full);
        if (found) return found;
      } else if (entry.name === 'interview-prep.json') return dir;
    }
    return null;
  };
  return walk(env.dataDir);
}

test('interview preparation: questions, feedback, summary, repeat', async () => {
  const longAnswer = (n: number) => `Answer number ${n}: in my last project I built a concrete feature together with the team and measured the result.`;
  const shortAnswer = 'Not sure.';

  await page.getByRole('link', { name: 'Applications' }).first().click();
  await page.getByRole('link', { name: 'Interview preparation' }).click();
  await page.getByRole('button', { name: 'Create the questions' }).click();
  await expect(page.getByTestId('question-card')).toHaveCount(9, { timeout: 60_000 });

  // The package itself must stay untouched by everything below: the preparation lives in its own file.
  const folder = preparedApplicationFolder();
  expect(folder).not.toBeNull();
  const packageFile = path.join(folder as string, 'package.json');
  const before = (JSON.parse(fs.readFileSync(packageFile, 'utf8')) as { updatedAt: string }).updatedAt;
  expect(typeof before).toBe('string');

  // Nine answers; the third and the sixth are short, which the scripted helper rates as weak.
  for (let i = 1; i <= 9; i++) {
    if (i === 1) await page.getByRole('button', { name: 'Continue' }).click();
    const field = page.getByRole('textbox', { name: 'Your answer' });
    await expect(field).toBeVisible();
    await field.fill(i === 3 || i === 6 ? shortAnswer : longAnswer(i));
    await page.getByRole('button', { name: 'Get feedback' }).click();
    await expect(page.getByText('Weak in content')).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Next', exact: true }).click();
  }

  // After the last feedback, "Next" leads to the summary, which asks for the figure once.
  await expect(page.getByRole('heading', { name: 'Summary' })).toBeVisible();
  await expect(page.getByText('≈ 70%', { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/this is no promise and no forecast of the result/)).toBeVisible();
  const weakBlock = page.getByRole('region', { name: 'Still weak' });
  await expect(weakBlock.getByRole('listitem')).toHaveCount(2);

  // Repeat one weak question with a long answer: the old figure is stale, a new call gives a higher one, and the old one stays visible.
  await weakBlock.getByRole('button', { name: 'Repeat', exact: true }).first().click();
  await page.getByRole('button', { name: 'Try again' }).click();
  await page.getByRole('textbox', { name: 'Your answer' }).fill(longAnswer(0));
  await page.getByRole('button', { name: 'Get feedback' }).click();
  await expect(page.getByText('The answer is concrete')).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByText('≈ 80%', { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('Before: ≈ 70%')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Still weak' }).getByRole('listitem')).toHaveCount(1);

  const after = (JSON.parse(fs.readFileSync(packageFile, 'utf8')) as { updatedAt: string }).updatedAt;
  expect(after).toBe(before);
});

test('transfer: a password-protected file opens on an empty install from the first step', async ({ browser }: { browser: Browser }) => {
  const password = 'перенос-пароль-1';
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-e2e-transfer-'));
  const second = await startApp();
  const stranger = await browser.newContext({ locale: 'en-US' });
  try {
    // Save the file on the first copy: with a password, in the way a person does it.
    await page.getByRole('link', { name: 'Settings' }).first().click();
    await page.getByRole('textbox', { name: 'Password for the file (optional)' }).fill(password);
    await page.getByRole('textbox', { name: 'Repeat the password' }).fill(password);
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save file' }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toMatch(/^BewerbungsPilot-transfer-\d{4}-\d{2}-\d{2}-\d{4}-encrypted\.zip$/);
    const file = path.join(tmp, download.suggestedFilename());
    await download.saveAs(file);
    expect(fs.readFileSync(file).subarray(0, 5).toString('latin1')).toBe('BPENC');
    await expect(page.getByText(/^The browser received the file/)).toBeVisible();

    // A second copy of the app on empty folders: the first welcome step offers the file.
    const other = await stranger.newPage();
    await other.goto(`${second.url}/open?key=${encodeURIComponent(second.key)}`);
    await other.getByRole('button', { name: 'I already have a file' }).click();
    await other.locator('input[type=file]').setInputFiles(file);
    const field = other.getByLabel('Password for this file');
    const open = other.getByRole('button', { name: 'Open file' });
    await expect(field).toBeVisible();
    await expect(open).toBeDisabled();

    // The wrong password: told, nothing opened, the file stays chosen.
    await field.fill('falsches-passwort-1');
    await open.click();
    await expect(other.getByRole('alert')).toContainText('the password is wrong or the file is damaged');
    await expect(other.getByText(path.basename(file))).toBeVisible();
    await expect(other.getByRole('link', { name: 'Profile' })).toHaveCount(0);

    // The right one: no welcome steps, the three things left to do, and the data is there.
    await field.fill(password);
    await open.click();
    await expect(other.getByRole('link', { name: 'Profile' }).first()).toBeVisible({ timeout: 60_000 });
    const notice = other.locator('.import-notice');
    await expect(notice).toBeVisible();
    await expect(notice.getByRole('listitem')).toHaveCount(3);
    await notice.getByRole('button', { name: 'Hide this message' }).click();
    await expect(notice).toBeHidden();

    await other.getByRole('link', { name: 'Profile' }).first().click();
    await other.getByRole('button', { name: 'Edit' }).first().click();
    await expect(other.getByRole('textbox', { name: 'Full name' })).toHaveValue('Max Mustermann');
    await other.getByRole('link', { name: 'Applications' }).first().click();
    await expect(other.getByText('Frontend-Entwickler').first()).toBeVisible();
  } finally {
    await stranger.close();
    await second.stop();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('feedback goes to the cloud service with exactly the announced fields, and the install number stays on the server', async () => {
  await page.getByRole('link', { name: 'Settings' }).first().click();
  await expect(page.getByRole('button', { name: 'Save backup' })).toBeVisible();
  await page.getByRole('button', { name: 'Feedback' }).click();
  const dialog = page.getByRole('dialog', { name: 'Send feedback' });
  await dialog.getByRole('radio', { name: 'Idea' }).check();
  await dialog.getByRole('textbox', { name: 'Your message' }).fill('Please add a dark theme switch.');
  await dialog.getByRole('textbox', { name: 'Your email (for our reply)' }).fill('max.mustermann@example.com');
  await dialog.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('Thank you! Your message was sent.')).toBeVisible();

  const feedback = cloudRequests().filter((r) => r.url === '/v1/feedback');
  expect(feedback).toHaveLength(1);
  expect(feedback[0].method).toBe('POST');
  const body = JSON.parse(feedback[0].body) as Record<string, unknown>;
  expect(Object.keys(body).sort()).toEqual(['email', 'installId', 'kind', 'language', 'text', 'version']);
  expect(body).toMatchObject({ email: 'max.mustermann@example.com', kind: 'idea', language: 'en', text: 'Please add a dark theme switch.' });
  expect(typeof body.version).toBe('string');
  expect(typeof body.installId).toBe('string');
  expect((body.installId as string).length).toBeGreaterThan(8);

  // Reload so that settings and every other answer have been fetched at least once with the dialog behind us.
  await page.getByRole('button', { name: 'Close' }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Save backup' })).toBeVisible();
  expect(seenResponses.length).toBeGreaterThan(0);
  expect(seenResponses.filter((t) => t.includes(body.installId as string))).toHaveLength(0);
});

test('the update banner shows a newer version and stays hidden once dismissed', async () => {
  const banner = page.getByText('Version 99.0.0 is available');
  // The server's first check runs a minute after the start, and the page asks only when it loads.
  await expect(async () => {
    await page.reload();
    await expect(banner).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 120_000, intervals: [2_000, 5_000] });

  // "Update now" against a download that cannot match the announced checksum: told, nothing installed, app works.
  await page.getByRole('button', { name: 'Update now' }).click();
  await expect(page.getByText(/does not match the published checksum/)).toBeVisible({ timeout: 60_000 });
  await page.getByRole('status').getByRole('button', { name: 'Close' }).click();
  await page.reload();
  await expect(page.getByRole('link', { name: 'Settings' }).first()).toBeVisible();
  await expect(banner).toBeVisible({ timeout: 20_000 });
  // The usage ping is off in test mode: after the first update check (a minute in) the cloud has seen no ping.
  expect(cloudRequests().filter((r) => r.url.includes('ping'))).toHaveLength(0);

  await page.getByRole('button', { name: 'Hide until the next version' }).click();
  await expect(banner).toBeHidden();
  await page.reload();
  await expect(page.getByRole('link', { name: 'Settings' }).first()).toBeVisible();
  await expect(banner).toBeHidden();
});

test('without the launch key the app shows only the shortcut page', async ({ browser }: { browser: Browser }) => {
  const stranger = await browser.newContext({ locale: 'en-US' });
  try {
    const other = await stranger.newPage();
    await other.goto(`${env.url}/`);
    await expect(other.getByRole('heading', { name: 'Open BewerbungsPilot with its shortcut' })).toBeVisible();
    await expect(other.getByRole('link', { name: 'Profile' })).toHaveCount(0);
  } finally {
    await stranger.close();
  }
});
