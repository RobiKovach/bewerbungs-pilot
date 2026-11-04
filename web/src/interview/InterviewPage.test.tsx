import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockFetch, type RouteHandler } from '../test/fetchMock';
import { appSummary, appView, jobState } from '../test/applicationFixtures';
import { ApplicationsPage } from '../pages/ApplicationsPage';
import { interviewRouteId, nextQuestion, questionState } from './format';
import type { ApplicationStatus, InterviewPrep, InterviewPrepView, PrepFeedback, PrepKind, PrepQuestion } from '../types';

const FEEDBACK: PrepFeedback = { weak: false, content: 'ok', languageFixes: [], better: 'Besser' };
const KINDS: PrepKind[] = ['experience', 'experience', 'experience', 'experience', 'theory', 'theory', 'theory', 'theory', 'practice'];

function question(i: number, over: Partial<PrepQuestion> = {}): PrepQuestion {
  return { id: `q${i + 1}`, kind: KINDS[i], text: `Frage ${i + 1}`, code: null, answer: null, ...over };
}
function prep(over: Partial<InterviewPrep> = {}, questions: PrepQuestion[] = KINDS.map((_, i) => question(i))): InterviewPrep {
  return {
    schemaVersion: 1, applicationId: 'app1', language: 'de', createdAt: '2026-11-04T08:00:00.000Z', updatedAt: '2026-11-04T08:00:00.000Z',
    questions, employerQuestions: ['Wie sieht das Team aus?', 'Wie läuft die Einarbeitung?', 'Welche Projekte kommen?'], summary: null, ...over,
  };
}
const prepView = (over: Partial<InterviewPrepView> = {}): InterviewPrepView => ({ prep: prep(), canStart: true, readOnly: false, defaultLanguage: 'de', ...over });
const answered = (feedback: PrepFeedback | null) => ({ text: 'Antwort', dontKnow: false, updatedAt: '2026-11-04T08:00:00.000Z', feedback });

function open(view: InterviewPrepView, routes: Record<string, RouteHandler> = {}) {
  window.location.hash = '#/applications/app1/interview';
  const f = mockFetch({
    'GET /api/applications/app1': () => ({ body: appView({}, { status: 'sent' }) }),
    'GET /api/applications/app1/interview': () => ({ body: view }),
    ...routes,
  });
  render(<ApplicationsPage pollMs={10} />);
  return { f, user: userEvent.setup() };
}

afterEach(() => { window.location.hash = ''; });

describe('interview helpers', () => {
  it('reads the application id only from the interview address', () => {
    expect(interviewRouteId('#/applications/app_1-x/interview')).toBe('app_1-x');
    expect(interviewRouteId('#/applications/app1')).toBeNull();
    expect(interviewRouteId('#/applications/../x/interview')).toBeNull();
  });
  it('tells the four states of a question apart', () => {
    expect(questionState(question(0))).toBe('open');
    expect(questionState(question(0, { answer: answered(null) }))).toBe('pending');
    expect(questionState(question(0, { answer: answered(FEEDBACK) }))).toBe('done');
    expect(questionState(question(0, { answer: answered({ ...FEEDBACK, weak: true }) }))).toBe('weak');
  });
  it('continues with the first question without feedback, and with none when all have it', () => {
    const qs = KINDS.map((_, i) => question(i, { answer: answered(FEEDBACK) }));
    expect(nextQuestion(qs)).toBeNull();
    qs[3] = question(3, { answer: answered(null) });
    expect(nextQuestion(qs)?.id).toBe('q4');
  });
});

describe('entry to the preparation', () => {
  const editor = (status: ApplicationStatus, routes: Record<string, RouteHandler> = {}) => {
    window.location.hash = '#/applications/app1';
    mockFetch({
      'GET /api/applications/app1': () => ({ body: appView({}, { status }) }),
      'GET /api/applications/job': () => ({ body: jobState() }),
      ...routes,
    });
    render(<ApplicationsPage pollMs={10} />);
  };
  it.each(['sent', 'submitted', 'interview'] as const)('the editor links to it for %s', async (status) => {
    editor(status);
    expect(await screen.findByRole('link', { name: 'Interview preparation' })).toHaveAttribute('href', '#/applications/app1/interview');
  });
  it('the editor has no link for a draft', async () => {
    editor('draft');
    await screen.findByRole('heading', { name: /Muster GmbH/ });
    expect(screen.queryByRole('link', { name: 'Interview preparation' })).toBeNull();
  });
  it('a closed application links to a saved preparation only', async () => {
    editor('rejected', { 'GET /api/applications/app1/interview': () => ({ body: prepView({ canStart: false, readOnly: true }) }) });
    expect(await screen.findByRole('link', { name: 'Interview preparation' })).toBeInTheDocument();
  });
  it('a closed application without a preparation has no link', async () => {
    const seen: string[] = [];
    editor('rejected', { 'GET /api/applications/app1/interview': () => { seen.push('asked'); return { body: prepView({ prep: null, canStart: false, readOnly: true }) }; } });
    await waitFor(() => expect(seen).toHaveLength(1));
    await screen.findByRole('heading', { name: /Muster GmbH/ });
    expect(screen.queryByRole('link', { name: 'Interview preparation' })).toBeNull();
  });
  it('the list links from sent applications, not from drafts', async () => {
    window.location.hash = '#/applications';
    mockFetch({ 'GET /api/applications': () => ({ body: { applications: [
      appSummary({ id: 'a1', status: 'sent' }),
      appSummary({ id: 'a2', vacancyId: 'v2', status: 'draft' }),
    ] } }) });
    render(<ApplicationsPage />);
    const rows = await screen.findAllByRole('listitem');
    expect(within(rows[0]).getByRole('link', { name: 'Interview preparation' })).toHaveAttribute('href', '#/applications/a1/interview');
    expect(within(rows[1]).queryByRole('link', { name: 'Interview preparation' })).toBeNull();
  });
});

describe('InterviewPage', () => {
  it('without a set asks for the language, then shows 9 cards and 0 of 9 done', async () => {
    let body: unknown;
    const { user } = open(prepView({ prep: null, defaultLanguage: 'en' }), {
      'POST /api/applications/app1/interview': (init) => { body = JSON.parse(String(init?.body)); return { body: prepView() }; },
    });
    expect(await screen.findByRole('radio', { name: 'English' })).toBeChecked();
    await user.click(screen.getByRole('radio', { name: 'German' }));
    await user.click(screen.getByRole('button', { name: 'Create the questions' }));
    expect(await screen.findByText('Done: 0 of 9')).toBeInTheDocument();
    expect(body).toEqual({ language: 'de' });
    expect(screen.getAllByTestId('question-card')).toHaveLength(9);
  });
  it('a failed start shows the error and keeps the language choice', async () => {
    const { user } = open(prepView({ prep: null }), {
      'POST /api/applications/app1/interview': () => ({ status: 429, body: { error: { code: 'LLM_LIMIT', detailsForLog: 'limit' } } }),
    });
    await user.click(await screen.findByRole('radio', { name: 'English' }));
    await user.click(screen.getByRole('button', { name: 'Create the questions' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'English' })).toBeChecked();
  });
  it('counts only questions with feedback: a pending answer does not count, and employer questions neither', async () => {
    const qs = KINDS.map((_, i) => question(i));
    qs[0] = question(0, { answer: answered(FEEDBACK) });
    qs[1] = question(1, { answer: answered({ ...FEEDBACK, weak: true }) });
    qs[2] = question(2, { answer: answered(null) });
    open(prepView({ prep: prep({}, qs) }));
    expect(await screen.findByText('Done: 2 of 9')).toBeInTheDocument();
    const cards = screen.getAllByTestId('question-card');
    expect(within(cards[0]).getByText('Done')).toBeInTheDocument();
    expect(within(cards[1]).getByText('Weak')).toBeInTheDocument();
    expect(within(cards[2]).getByText('Waiting for feedback')).toBeInTheDocument();
    expect(within(cards[3]).getByText('Not done')).toBeInTheDocument();
    const block = screen.getByRole('region', { name: 'Your questions for the employer' });
    expect(within(block).getAllByRole('listitem')).toHaveLength(3);
    expect(within(block).queryByRole('button')).toBeNull();
  });
  it('a practical task with code shows the code instead of a picture, others a picture', async () => {
    const qs = KINDS.map((_, i) => question(i));
    qs[8] = question(8, { code: 'return a + b;' });
    open(prepView({ prep: prep({}, qs) }));
    const cards = await screen.findAllByTestId('question-card');
    expect(within(cards[8]).getByText('return a + b;').tagName).toBe('PRE');
    expect(cards[8].querySelector('svg')).toBeNull();
    expect(cards[0].querySelector('svg')).not.toBeNull();
    expect(cards[0].querySelector('img')).toBeNull();
  });
  it('a practical task without code has a picture too', async () => {
    open(prepView());
    const cards = await screen.findAllByTestId('question-card');
    expect(cards[8].querySelector('svg')).not.toBeNull();
    expect(cards[8].querySelector('pre')).toBeNull();
  });
  it('Continue opens the first question without feedback, and Back returns to the cards', async () => {
    const qs = KINDS.map((_, i) => question(i));
    qs[0] = question(0, { answer: answered(FEEDBACK) });
    const { user } = open(prepView({ prep: prep({}, qs) }));
    await user.click(await screen.findByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('heading', { name: 'Frage 2' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'All questions' }));
    expect(screen.getAllByTestId('question-card')).toHaveLength(9);
  });
  it('all with feedback: the top button opens the summary and no figure is invented', async () => {
    const qs = KINDS.map((_, i) => question(i, { answer: answered(FEEDBACK) }));
    const { user } = open(prepView({ prep: prep({}, qs) }));
    await user.click(await screen.findByRole('button', { name: 'Summary' }));
    expect(await screen.findByRole('heading', { name: 'Summary' })).toBeInTheDocument();
    expect(screen.queryByText(/≈/)).toBeNull();
  });
  it('read-only: no Continue, a note, and the cards can still be opened', async () => {
    const { user } = open(prepView({ canStart: false, readOnly: true }));
    expect(await screen.findByText(/can only be viewed/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
    await user.click(within(screen.getAllByTestId('question-card')[0]).getByRole('button', { name: 'View' }));
    expect(screen.getByRole('heading', { name: 'Frage 1' })).toBeInTheDocument();
  });
  it('a closed application without a set cannot start one', async () => {
    open(prepView({ prep: null, canStart: false, readOnly: true }));
    expect(await screen.findByText(/no preparation/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create the questions' })).toBeNull();
  });
  it('a loading error shows the banner', async () => {
    open(prepView(), { 'GET /api/applications/app1/interview': () => ({ status: 409, body: { error: { code: 'CONFLICT', detailsForLog: 'x', reason: 'prepUnreadable' } } }) });
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be read');
  });
});
