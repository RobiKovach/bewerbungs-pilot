import { StrictMode } from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockFetch, type RouteHandler } from '../test/fetchMock';
import { appView } from '../test/applicationFixtures';
import { ApplicationsPage } from '../pages/ApplicationsPage';
import type { ApplicationStatus, InterviewPrep, InterviewPrepView, PrepKind, PrepQuestion, PrepSummary } from '../types';

const KINDS: PrepKind[] = ['experience', 'experience', 'experience', 'experience', 'theory', 'theory', 'theory', 'theory', 'practice'];
const SUMMARY_ROUTE = 'POST /api/applications/app1/interview/summary';
const START_ROUTE = 'POST /api/applications/app1/interview';
const CAPTION = /Rough AI estimate from your answers here only/;
const SUMMARY: PrepSummary = {
  percent: 60, previousPercent: null,
  areas: { experience: 'Experience text', theory: 'Theory text', practice: 'Practice text', language: 'Language text' },
  biggestRisk: { questionId: 'q2', why: 'The example is missing.' },
  fingerprint: 'f', createdAt: '2026-11-04T09:00:00.000Z',
};

/** Questions in `weak` have weak feedback, in `open` have no answer, the others good feedback. */
const questions = (weak: number[] = [2], open: number[] = []): PrepQuestion[] => KINDS.map((kind, i) => {
  const n = i + 1;
  return {
    id: `q${n}`, kind, text: `Frage ${n}`, code: null,
    answer: open.includes(n) ? null : {
      text: `Antwort ${n}`, dontKnow: false, updatedAt: '2026-11-04T08:00:00.000Z',
      feedback: { weak: weak.includes(n), content: `Inhalt ${n}`, languageFixes: [], better: `Besser ${n}` },
    },
  };
});
const prep = (over: Partial<InterviewPrep> = {}): InterviewPrep => ({
  schemaVersion: 1, applicationId: 'app1', language: 'de', createdAt: '2026-11-04T08:00:00.000Z', updatedAt: '2026-11-04T08:00:00.000Z',
  questions: questions(), employerQuestions: ['Wie sieht das Team aus?'], summary: null, ...over,
});
const view = (over: Partial<InterviewPrep> = {}, viewOver: Partial<InterviewPrepView> = {}): InterviewPrepView => ({ prep: prep(over), canStart: true, readOnly: false, defaultLanguage: 'de', ...viewOver });

function open(v: InterviewPrepView, routes: Record<string, RouteHandler> = {}, pending: string[] = [], status: ApplicationStatus = 'sent') {
  window.location.hash = '#/applications/app1/interview';
  const f = mockFetch({
    'GET /api/applications/app1': () => ({ body: appView({}, { status }) }),
    'GET /api/applications/app1/interview': () => ({ body: v }),
    ...routes,
  }, { pending });
  render(<ApplicationsPage pollMs={10} />);
  return { f, user: userEvent.setup() };
}
const calls = (f: ReturnType<typeof mockFetch>, route: string) => f.mock.calls.filter(([url, init]) => `${init?.method ?? 'GET'} ${url}` === route);
const openSummary = async (user: ReturnType<typeof userEvent.setup>) => user.click(await screen.findByRole('button', { name: 'Summary' }));

afterEach(() => { window.location.hash = ''; });

describe('the summary', () => {
  it('shows the figure with its caption, four areas and the biggest risk, and does not ask the AI again', async () => {
    const { f, user } = open(view({ summary: SUMMARY }));
    await openSummary(user);
    const figure = await screen.findByText('≈ 60%');
    expect(within(figure.closest('.chance') as HTMLElement).getByText(CAPTION)).toBeInTheDocument();
    for (const text of ['Experience text', 'Theory text', 'Practice text', 'Language text', 'The example is missing.']) expect(screen.getByText(text)).toBeInTheDocument();
    expect(calls(f, SUMMARY_ROUTE)).toHaveLength(0);
  });

  it('the risk link opens that question', async () => {
    const { user } = open(view({ summary: SUMMARY }));
    await openSummary(user);
    const risk = await screen.findByRole('region', { name: 'What to repeat first' });
    await user.click(within(risk).getByRole('button', { name: 'Frage 2' }));
    expect(await screen.findByRole('heading', { name: 'Frage 2' })).toBeInTheDocument();
    expect(screen.getByText('Inhalt 2')).toBeInTheDocument();
  });

  it('before the set is done there is only progress, no figure and no way to the summary', async () => {
    open(view({ questions: questions([2], [5]) }));
    expect(await screen.findByText('Done: 8 of 9')).toBeInTheDocument();
    expect(screen.queryByText(/≈/)).toBeNull();
    expect(screen.queryByText(CAPTION)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Summary' })).toBeNull();
  });

  it('asks for the summary once when it opens without one', async () => {
    const { f, user } = open(view(), { [SUMMARY_ROUTE]: () => ({ body: view({ summary: SUMMARY }) }) });
    await openSummary(user);
    expect(await screen.findByText('≈ 60%')).toBeInTheDocument();
    expect(calls(f, SUMMARY_ROUTE)).toHaveLength(1);
  });

  it('a mount undone at once by StrictMode sends one request, not a cancelled one that makes the next busy', async () => {
    window.location.hash = '#/applications/app1/interview';
    const f = mockFetch({
      'GET /api/applications/app1': () => ({ body: appView({}, { status: 'sent' }) }),
      'GET /api/applications/app1/interview': () => ({ body: view() }),
      [SUMMARY_ROUTE]: () => ({ body: view({ summary: SUMMARY }) }),
    });
    render(<StrictMode><ApplicationsPage pollMs={10} /></StrictMode>);
    await openSummary(userEvent.setup());
    expect(await screen.findByText('≈ 60%')).toBeInTheDocument();
    expect(calls(f, SUMMARY_ROUTE)).toHaveLength(1);
  });

  it('Next opens the summary when every question has feedback', async () => {
    const { user } = open(view({ summary: SUMMARY }));
    await openSummary(user);
    await user.click(await screen.findByRole('button', { name: 'Open all answers' }));
    await user.click(screen.getAllByRole('button', { name: 'View' })[8]);
    await user.click(await screen.findByRole('button', { name: 'Next' }));
    expect(await screen.findByText('≈ 60%')).toBeInTheDocument();
  });

  it('Next goes to the open question, not the summary, while one still has no feedback', async () => {
    const { user } = open(view({ questions: questions([2], [5]) }));
    await screen.findByText('Done: 8 of 9');
    await user.click(screen.getAllByRole('button', { name: 'View' })[0]);
    await user.click(await screen.findByRole('button', { name: 'Next' }));
    expect(await screen.findByRole('heading', { name: 'Frage 5' })).toBeInTheDocument();
    expect(screen.queryByText(/≈/)).toBeNull();
  });

  it('lists what is still weak with Repeat', async () => {
    const { user } = open(view({ summary: SUMMARY, questions: questions([2, 7]) }));
    await openSummary(user);
    const weak = await screen.findByRole('region', { name: 'Still weak' });
    expect(within(weak).getByText('Frage 7')).toBeInTheDocument();
    expect(within(weak).queryByText('Frage 1')).toBeNull();
    await user.click(within(weak).getAllByRole('button', { name: 'Repeat' })[1]);
    expect(await screen.findByRole('heading', { name: 'Frage 7' })).toBeInTheDocument();
  });

  it('keeps the good list closed with its count, and says when nothing is weak', async () => {
    const { user } = open(view({ summary: SUMMARY, questions: questions([]) }));
    await openSummary(user);
    expect(await screen.findByText('No weak answers.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Repeat all weak' })).toBeNull();
    const good = screen.getByText('Went well (9)').closest('details') as HTMLDetailsElement;
    expect(good.open).toBe(false);
  });

  it('Repeat all weak walks through the weak questions, then back to the summary', async () => {
    const { user } = open(view({ summary: SUMMARY, questions: questions([2, 7]) }));
    await openSummary(user);
    await user.click(await screen.findByRole('button', { name: 'Repeat all weak' }));
    expect(await screen.findByRole('heading', { name: 'Frage 2' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByRole('heading', { name: 'Frage 7' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('≈ 60%')).toBeInTheDocument();
  });

  it('after repeating shows the old and the new figure', async () => {
    const { user } = open(view({ summary: { ...SUMMARY, percent: 70, previousPercent: 55 } }));
    await openSummary(user);
    expect(await screen.findByText('≈ 70%')).toBeInTheDocument();
    expect(screen.getByText('Before: ≈ 55%')).toBeInTheDocument();
  });

  it('shows no old figure the first time', async () => {
    const { user } = open(view({ summary: SUMMARY }));
    await openSummary(user);
    await screen.findByText('≈ 60%');
    expect(screen.queryByText(/Before:/)).toBeNull();
  });

  it('a failed summary keeps what was done and offers Try again', async () => {
    let fail = true;
    const { f, user } = open(view(), {
      [SUMMARY_ROUTE]: () => (fail ? { status: 429, body: { error: { code: 'LLM_LIMIT', detailsForLog: 'limit' } } } : { body: view({ summary: SUMMARY }) }),
    });
    await openSummary(user);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText(/≈/)).toBeNull();
    expect(calls(f, SUMMARY_ROUTE)).toHaveLength(1);
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('≈ 60%')).toBeInTheDocument();
    expect(calls(f, SUMMARY_ROUTE)).toHaveLength(2);
  });

  it('a failed summary leaves the done questions on the cards', async () => {
    const { user } = open(view(), { [SUMMARY_ROUTE]: () => ({ status: 429, body: { error: { code: 'LLM_LIMIT', detailsForLog: 'limit' } } }) });
    await openSummary(user);
    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: 'All questions' }));
    expect(await screen.findByText('Done: 9 of 9')).toBeInTheDocument();
  });

  it('Cancel stops the summary without an error and offers Try again', async () => {
    const { user } = open(view(), {}, [SUMMARY_ROUTE]);
    await openSummary(user);
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText(/not ready yet/)).toBeInTheDocument();
  });

  it('leaving a running summary cancels it', async () => {
    const { f, user } = open(view(), {}, [SUMMARY_ROUTE]);
    await openSummary(user);
    await waitFor(() => expect(calls(f, SUMMARY_ROUTE)).toHaveLength(1));
    const signal = calls(f, SUMMARY_ROUTE)[0][1]?.signal as AbortSignal;
    window.location.hash = '#/applications/app1';
    await waitFor(() => expect(signal.aborted).toBe(true));
  });

  it('a closed application can view a stored summary, but cannot repeat or replace', async () => {
    const { f, user } = open(view({ summary: SUMMARY }, { readOnly: true, canStart: false }), {}, [], 'rejected');
    await openSummary(user);
    expect(await screen.findByText('≈ 60%')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Repeat' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Repeat all weak' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'New questions' })).toBeNull();
    expect(calls(f, SUMMARY_ROUTE)).toHaveLength(0);
  });

  it('a closed application without a summary offers none and asks for none', async () => {
    const { f } = open(view({}, { readOnly: true, canStart: false }), {}, [], 'rejected');
    expect(await screen.findByText('Done: 9 of 9')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Summary' })).toBeNull();
    expect(calls(f, SUMMARY_ROUTE)).toHaveLength(0);
  });
});

describe('new questions and another language', () => {
  const fresh = (language: 'de' | 'en' = 'de') => view({ language, createdAt: '2026-11-04T10:00:00.000Z', questions: questions([], [1, 2, 3, 4, 5, 6, 7, 8, 9]).map((q) => ({ ...q, text: `Neu ${q.id}` })) });

  it('cancelling the warning changes nothing', async () => {
    const { f, user } = open(view({ summary: SUMMARY }));
    await openSummary(user);
    await user.click(await screen.findByRole('button', { name: 'New questions' }));
    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByText(/will be replaced/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByText('≈ 60%')).toBeInTheDocument();
    expect(calls(f, START_ROUTE)).toHaveLength(0);
  });

  it('confirming asks for a replacement in the same language and shows the new cards', async () => {
    const { f, user } = open(view({ summary: SUMMARY }), { [START_ROUTE]: () => ({ body: fresh() }) });
    await openSummary(user);
    await user.click(await screen.findByRole('button', { name: 'New questions' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Yes, create new ones' }));
    expect(await screen.findByText('Neu q1')).toBeInTheDocument();
    expect(screen.getByText('Done: 0 of 9')).toBeInTheDocument();
    expect(JSON.parse(calls(f, START_ROUTE)[0][1]?.body as string)).toEqual({ language: 'de', replace: true });
  });

  it('changing the language from the cards warns first and proposes the other language', async () => {
    const { f, user } = open(view({ questions: questions([2], [5]) }), { [START_ROUTE]: () => ({ body: fresh('en') }) });
    await user.click(await screen.findByRole('button', { name: 'Change language' }));
    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByRole('radio', { name: 'English' })).toBeChecked();
    await user.click(within(dialog).getByRole('button', { name: 'Yes, create new ones' }));
    await screen.findByText('Neu q1');
    expect(JSON.parse(calls(f, START_ROUTE)[0][1]?.body as string)).toEqual({ language: 'en', replace: true });
  });

  it('a new set drops the drafts of the old one', async () => {
    const { user } = open(view({ questions: questions([2], [1]) }), { [START_ROUTE]: () => ({ body: fresh() }) });
    await user.click(await screen.findByRole('button', { name: 'Continue' }));
    await user.type(await screen.findByRole('textbox', { name: /Your answer/ }), 'Alter Entwurf');
    await user.click(screen.getByRole('button', { name: 'All questions' }));
    await user.click(screen.getByRole('button', { name: 'Change language' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Yes, create new ones' }));
    await screen.findByText('Neu q1');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('textbox', { name: /Your answer/ })).toHaveValue('');
  });

  it('a set replaced elsewhere also drops the drafts and leaves the old question', async () => {
    let current = view({ questions: questions([2], [1]) });
    const { user } = open(current, {
      'GET /api/applications/app1/interview': () => ({ body: current }),
      'POST /api/applications/app1/interview/questions/q1/answer': () => {
        current = fresh();
        return { status: 409, body: { error: { code: 'CONFLICT', reason: 'packageChanged', detailsForLog: 'x' } } };
      },
    });
    await user.click(await screen.findByRole('button', { name: 'Continue' }));
    await user.type(await screen.findByRole('textbox', { name: /Your answer/ }), 'Alter Entwurf');
    await user.click(screen.getByRole('button', { name: 'Get feedback' }));
    expect(await screen.findByText('Neu q1')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('textbox', { name: /Your answer/ })).toHaveValue('');
  });

  it('a failed replacement keeps the set and says why', async () => {
    const { user } = open(view({ summary: SUMMARY }), { [START_ROUTE]: () => ({ status: 429, body: { error: { code: 'LLM_LIMIT', detailsForLog: 'limit' } } }) });
    await openSummary(user);
    await user.click(await screen.findByRole('button', { name: 'New questions' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Yes, create new ones' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('≈ 60%')).toBeInTheDocument();
  });

  it('a closed application cannot change the language', async () => {
    open(view({ summary: SUMMARY }, { readOnly: true, canStart: false }), {}, [], 'rejected');
    expect(await screen.findByText('Done: 9 of 9')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Change language' })).toBeNull();
  });
});
