import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { E2eEnv } from './server';

// The whole app once, start to finish, as a person uses it (spec 0.9.0, 3.5). The steps build on each other,
// so they share one browser tab and run in order. AI answers are scripted (--fake-llm), mail goes to files
// (--fake-mail) and the update check reads a local version.json that announces 99.0.0.

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const env = JSON.parse(process.env.BP_E2E ?? '{}') as E2eEnv;
const mailDir = () => path.join(env.dataDir, 'tmp', 'fake-mail');

interface FakeMail { to: string; subject: string; attachments: { filename: string; size: number }[] }

/** Mails written by the fake mailer, oldest first (file names start with the time). */
function sentMails(): FakeMail[] {
  if (!fs.existsSync(mailDir())) return [];
  return fs.readdirSync(mailDir()).sort().map((f) => JSON.parse(fs.readFileSync(path.join(mailDir(), f), 'utf8')) as FakeMail);
}

test.describe.configure({ mode: 'serial' });

let context: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  context = await browser.newContext({ locale: 'en-US' });
  page = await context.newPage();
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

test('the update banner shows a newer version and stays hidden once dismissed', async () => {
  const banner = page.getByText('Version 99.0.0 is available');
  // The server's first check runs a minute after the start, and the page asks only when it loads.
  await expect(async () => {
    await page.reload();
    await expect(banner).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 120_000, intervals: [2_000, 5_000] });

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
