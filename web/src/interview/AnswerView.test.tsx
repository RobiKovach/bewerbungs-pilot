import { describe, it, expect, afterEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockFetch, type RouteHandler } from '../test/fetchMock';
import { appView } from '../test/applicationFixtures';
import { ApplicationsPage } from '../pages/ApplicationsPage';
import { UnsavedProvider } from '../profile/unsaved';
import type { InterviewPrep, InterviewPrepView, PrepAnswer, PrepFeedback, PrepQuestion } from '../types';

const FEEDBACK: PrepFeedback = {
  weak: true,
  content: 'The example is missing.',
  languageFixes: [{ said: 'ich habe gegangen', correct: 'ich bin gegangen', why: 'Movement takes sein.' }],
  better: 'Ich bin zum Kunden gegangen.',
};
const answered = (over: Partial<PrepAnswer> = {}): PrepAnswer => ({ text: 'Meine Antwort', dontKnow: false, updatedAt: '2026-11-04T08:00:00.000Z', feedback: FEEDBACK, ...over });
const question = (i: number, over: Partial<PrepQuestion> = {}): PrepQuestion => ({ id: `q${i}`, kind: 'experience', text: `Frage ${i}`, code: null, answer: null, ...over });
const prep = (questions: PrepQuestion[]): InterviewPrep => ({
  schemaVersion: 1, applicationId: 'app1', language: 'de', createdAt: '2026-11-04T08:00:00.000Z', updatedAt: '2026-11-04T08:00:00.000Z',
  questions, employerQuestions: ['Wie sieht das Team aus?'], summary: null,
});
const view = (questions: PrepQuestion[], over: Partial<InterviewPrepView> = {}): InterviewPrepView => ({ prep: prep(questions), canStart: true, readOnly: false, defaultLanguage: 'de', ...over });
const ANSWER_ROUTE = 'POST /api/applications/app1/interview/questions/q1/answer';

/** Opens the first question without feedback through the Continue button. */
async function openQuestion(v: InterviewPrepView, routes: Record<string, RouteHandler> = {}, onUnsaved?: (dirty: boolean) => void, pending: string[] = []) {
  window.location.hash = '#/applications/app1/interview';
  mockFetch({
    'GET /api/applications/app1': () => ({ body: appView({}, { status: 'sent' }) }),
    'GET /api/applications/app1/interview': () => ({ body: v }),
    ...routes,
  }, { pending });
  render(<UnsavedProvider onChange={onUnsaved}><ApplicationsPage pollMs={10} /></UnsavedProvider>);
  const user = userEvent.setup();
  await screen.findAllByTestId('question-card');
  await user.click(screen.queryByRole('button', { name: 'Continue' }) ?? screen.getAllByRole('button', { name: 'View' })[0]);
  return user;
}
const field = () => screen.getByRole('textbox', { name: /Your answer/ });
const getFeedback = () => screen.getByRole('button', { name: 'Get feedback' });

afterEach(() => { window.location.hash = ''; });

describe('answering a question', () => {
  it('shows the question without hints, and asks for an answer before feedback', async () => {
    const user = await openQuestion(view([question(1)]));
    expect(screen.getByRole('heading', { name: 'Frage 1' })).toBeInTheDocument();
    expect(field()).toHaveValue('');
    expect(screen.queryByRole('region', { name: 'How to say it better' })).toBeNull();
    expect(getFeedback()).toBeDisabled();
    await user.type(field(), '   ');
    expect(getFeedback()).toBeDisabled();
    await user.type(field(), 'Text');
    expect(getFeedback()).toBeEnabled();
  });

  it('does not take more than 5 000 characters', async () => {
    await openQuestion(view([question(1)]));
    expect(field()).toHaveAttribute('maxlength', '5000');
    fireEvent.change(field(), { target: { value: 'x'.repeat(5000) } });
    expect(screen.getByText('5000 / 5000')).toBeInTheDocument();
  });

  it('sends the trimmed answer and shows all three feedback blocks', async () => {
    let body: unknown;
    const user = await openQuestion(view([question(1), question(2)]), {
      [ANSWER_ROUTE]: (init) => { body = JSON.parse(String(init?.body)); return { body: view([question(1, { answer: answered() }), question(2)]) }; },
    });
    await user.type(field(), ' Meine Antwort ');
    await user.click(getFeedback());
    const content = await screen.findByRole('region', { name: 'Weak in content' });
    expect(body).toEqual({ text: 'Meine Antwort', dontKnow: false, setCreatedAt: '2026-11-04T08:00:00.000Z' });
    expect(within(content).getByText('The example is missing.')).toBeInTheDocument();
    const language = screen.getByRole('region', { name: 'Language mistakes' });
    expect(within(language).getByText('ich habe gegangen')).toBeInTheDocument();
    expect(within(language).getByText('ich bin gegangen')).toBeInTheDocument();
    expect(within(language).getByText('Movement takes sein.')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'How to say it better' })).getByText('Ich bin zum Kunden gegangen.')).toBeInTheDocument();
  });

  it('a good answer is not shown under the heading Weak in content', async () => {
    const good = answered({ feedback: { ...FEEDBACK, weak: false, content: 'Concrete and complete.' } });
    const user = await openQuestion(view([question(1), question(2)]), {
      [ANSWER_ROUTE]: () => ({ body: view([question(1, { answer: good }), question(2)]) }),
    });
    await user.type(field(), 'Meine Antwort');
    await user.click(getFeedback());
    const content = await screen.findByRole('region', { name: 'Content' });
    expect(within(content).getByText('Concrete and complete.')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Weak in content' })).toBeNull();
  });

  it('an answer without language mistakes says so', async () => {
    await openQuestion(view([question(1, { answer: answered({ feedback: { ...FEEDBACK, languageFixes: [] } }) })]));
    expect(within(screen.getByRole('region', { name: 'Language mistakes' })).getByText('No language mistakes found.')).toBeInTheDocument();
  });

  it('"I don\'t know" sends no text, and there is no language verdict on an answer that was not given', async () => {
    let body: unknown;
    const after = view([question(1, { answer: answered({ text: '', dontKnow: true, feedback: { ...FEEDBACK, languageFixes: [] } }) })]);
    const user = await openQuestion(view([question(1)]), {
      [ANSWER_ROUTE]: (init) => { body = JSON.parse(String(init?.body)); return { body: after }; },
    });
    await user.click(screen.getByRole('button', { name: "I don't know" }));
    const language = await screen.findByRole('region', { name: 'Language mistakes' });
    expect(body).toEqual({ text: '', dontKnow: true, setCreatedAt: '2026-11-04T08:00:00.000Z' });
    expect(within(language).queryByText('No language mistakes found.')).toBeNull();
    expect(within(language).getByText('There was no answer, so the language was not checked.')).toBeInTheDocument();
  });

  describe('"I don\'t know" on a question whose answer is saved, when the AI call does not finish', () => {
    /** The server overwrites the text before it asks the AI, so every later read returns it empty. */
    const savedThenErased = () => {
      const gets = { count: 0 };
      const route = () => {
        gets.count += 1;
        return { body: view([question(1, { answer: gets.count === 1 ? answered({ feedback: null }) : answered({ text: '', dontKnow: true, feedback: null }) })]) };
      };
      return { gets, route };
    };

    it('a failure keeps the text in the field', async () => {
      const { gets, route } = savedThenErased();
      const user = await openQuestion(view([]), {
        'GET /api/applications/app1/interview': route,
        [ANSWER_ROUTE]: () => ({ status: 429, body: { error: { code: 'LLM_LIMIT', detailsForLog: 'limit' } } }),
      });
      await user.click(screen.getByRole('button', { name: "I don't know" }));
      await screen.findByRole('alert');
      await waitFor(() => expect(gets.count).toBe(2));
      expect(await screen.findByRole('textbox', { name: /Your answer/ })).toHaveValue('Meine Antwort');
    });

    it('Cancel keeps the text in the field', async () => {
      const { gets, route } = savedThenErased();
      const user = await openQuestion(view([]), { 'GET /api/applications/app1/interview': route }, undefined, [ANSWER_ROUTE]);
      await user.click(screen.getByRole('button', { name: "I don't know" }));
      await user.click(await screen.findByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(gets.count).toBe(2));
      expect(await screen.findByRole('textbox', { name: /Your answer/ })).toHaveValue('Meine Antwort');
    });
  });

  it('a refusal that makes the preparation read-only still shows the typed text, to copy', async () => {
    let refused = false;
    const user = await openQuestion(view([]), {
      'GET /api/applications/app1/interview': () => ({ body: view([question(1)], { canStart: false, readOnly: refused }) }),
      [ANSWER_ROUTE]: () => { refused = true; return { status: 409, body: { error: { code: 'CONFLICT', detailsForLog: 'x', reason: 'prepReadOnly' } } }; },
    });
    await user.type(field(), 'Mein langer Text');
    await user.click(getFeedback());
    await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
    expect(screen.getByText('Mein langer Text')).toBeInTheDocument();
    expect(screen.getByText(/not saved/)).toBeInTheDocument();
  });

  it('sends the set it shows; when the set was replaced elsewhere the typed text stays on screen to copy', async () => {
    let replaced = false;
    let sent: { setCreatedAt?: string } = {};
    const newSet = view([question(1, { text: 'Neue Frage 1' })]);
    newSet.prep!.createdAt = '2026-11-05T10:00:00.000Z';
    const user = await openQuestion(view([]), {
      'GET /api/applications/app1/interview': () => ({ body: replaced ? newSet : view([question(1)]) }),
      [ANSWER_ROUTE]: (init) => {
        sent = JSON.parse(String(init?.body)) as { setCreatedAt?: string };
        replaced = true;
        return { status: 409, body: { error: { code: 'CONFLICT', detailsForLog: 'x', reason: 'packageChanged' } } };
      },
    });
    await user.type(field(), 'Mein langer Text');
    await user.click(getFeedback());
    await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
    expect(sent.setCreatedAt).toBe('2026-11-04T08:00:00.000Z');
    expect(await screen.findByText('Mein langer Text')).toBeInTheDocument();
    expect(screen.getByText(/questions were replaced/)).toBeInTheDocument();
  });

  it('the "waiting for feedback" note is only there when the visible text is the saved one', async () => {
    const user = await openQuestion(view([question(1, { answer: answered({ feedback: null }) })]));
    expect(screen.getByText(/feedback is still missing/)).toBeInTheDocument();
    await user.type(field(), ' und mehr');
    expect(screen.queryByText(/feedback is still missing/)).toBeNull();
  });

  it('a waiting "I don\'t know" has no note about a saved answer', async () => {
    await openQuestion(view([question(1, { answer: answered({ text: '', dontKnow: true, feedback: null }) })]));
    expect(screen.queryByText(/feedback is still missing/)).toBeNull();
    expect(screen.getByRole('button', { name: "I don't know" })).toBeEnabled();
  });

  it('text typed before "I don\'t know" comes back with Try again', async () => {
    const after = view([question(1, { answer: answered({ text: '', dontKnow: true }) })]);
    const user = await openQuestion(view([question(1)]), { [ANSWER_ROUTE]: () => ({ body: after }) });
    await user.type(field(), 'Halb fertig');
    await user.click(screen.getByRole('button', { name: "I don't know" }));
    await user.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(field()).toHaveValue('Halb fertig');
  });

  it('the AI limit gives a clear message and the text stays', async () => {
    const user = await openQuestion(view([question(1)]), {
      [ANSWER_ROUTE]: () => ({ status: 429, body: { error: { code: 'LLM_LIMIT', detailsForLog: 'limit' } } }),
    });
    await user.type(field(), 'Meine Antwort');
    await user.click(getFeedback());
    expect(await screen.findByRole('alert')).toHaveTextContent('limit');
    expect(field()).toHaveValue('Meine Antwort');
  });

  it('after a failed call the saved answer counts as waiting for feedback on the cards', async () => {
    let saved = false;
    const before = view([question(1)]);
    const waiting = view([question(1, { answer: answered({ feedback: null }) })]);
    window.location.hash = '#/applications/app1/interview';
    mockFetch({
      'GET /api/applications/app1': () => ({ body: appView({}, { status: 'sent' }) }),
      'GET /api/applications/app1/interview': () => ({ body: saved ? waiting : before }),
      [ANSWER_ROUTE]: () => { saved = true; return { status: 429, body: { error: { code: 'LLM_LIMIT', detailsForLog: 'limit' } } }; },
    });
    render(<ApplicationsPage pollMs={10} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Continue' }));
    await user.type(field(), 'Meine Antwort');
    await user.click(getFeedback());
    await screen.findByRole('alert');
    await screen.findByText(/feedback is still missing/);
    await user.click(screen.getByRole('button', { name: 'All questions' }));
    expect(within(screen.getByTestId('question-card')).getByText('Waiting for feedback')).toBeInTheDocument();
  });

  it('a question waiting for feedback opens with the saved text and can be sent again', async () => {
    let body: unknown;
    const user = await openQuestion(view([question(1, { answer: answered({ feedback: null }) })]), {
      [ANSWER_ROUTE]: (init) => { body = JSON.parse(String(init?.body)); return { body: view([question(1, { answer: answered() })]) }; },
    });
    expect(field()).toHaveValue('Meine Antwort');
    expect(screen.getByText(/feedback is still missing/)).toBeInTheDocument();
    await user.click(getFeedback());
    await screen.findByRole('region', { name: 'Weak in content' });
    expect(body).toEqual({ text: 'Meine Antwort', dontKnow: false, setCreatedAt: '2026-11-04T08:00:00.000Z' });
  });

  it('Cancel stops the wait without an error and keeps the text', async () => {
    const user = await openQuestion(view([question(1)]), {}, undefined, [ANSWER_ROUTE]);
    await user.type(field(), 'Meine Antwort');
    await user.click(getFeedback());
    expect(screen.queryByRole('button', { name: 'All questions' })).toBeNull();
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(await screen.findByRole('textbox', { name: /Your answer/ })).toHaveValue('Meine Antwort');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('Try again fills the field with the answer; nothing is sent until asked', async () => {
    const send = vi.fn(() => ({ body: view([question(1, { answer: answered() })]) }));
    const user = await openQuestion(view([question(1, { answer: answered() })]), { [ANSWER_ROUTE]: send });
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(field()).toHaveValue('Meine Antwort');
    expect(send).not.toHaveBeenCalled();
  });

  it('Next goes to the next question without feedback', async () => {
    const after = view([question(1, { answer: answered() }), question(2)]);
    const user = await openQuestion(view([question(1), question(2)]), { [ANSWER_ROUTE]: () => ({ body: after }) });
    await user.click(screen.getByRole('button', { name: "I don't know" }));
    await user.click(await screen.findByRole('button', { name: 'Next' }));
    expect(screen.getByRole('heading', { name: 'Frage 2' })).toBeInTheDocument();
    expect(field()).toHaveValue('');
  });

  it('after the last question Next opens the summary', async () => {
    const done = view([question(1, { answer: answered() })]);
    const user = await openQuestion(done, { 'POST /api/applications/app1/interview/summary': () => ({ status: 429, body: { error: { code: 'LLM_LIMIT', detailsForLog: 'limit' } } }) });
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByRole('heading', { name: 'Summary' })).toBeInTheDocument();
  });

  it('typed text warns about leaving, keeps its place when going to the cards, and stops warning once saved', async () => {
    const changes: boolean[] = [];
    const user = await openQuestion(view([question(1)]), {
      [ANSWER_ROUTE]: () => ({ body: view([question(1, { answer: answered() })]) }),
    }, (dirty) => changes.push(dirty));
    await user.type(field(), 'Meine Antwort');
    await waitFor(() => expect(changes.at(-1)).toBe(true));
    await user.click(screen.getByRole('button', { name: 'All questions' }));
    expect(changes.at(-1)).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(field()).toHaveValue('Meine Antwort');
    await user.click(getFeedback());
    await screen.findByRole('region', { name: 'Weak in content' });
    await waitFor(() => expect(changes.at(-1)).toBe(false));
  });

  it('read-only: answer and feedback can be read, nothing can be changed', async () => {
    window.location.hash = '#/applications/app1/interview';
    mockFetch({
      'GET /api/applications/app1': () => ({ body: appView({}, { status: 'rejected' }) }),
      'GET /api/applications/app1/interview': () => ({ body: view([question(1, { answer: answered() })], { canStart: false, readOnly: true }) }),
    });
    render(<ApplicationsPage pollMs={10} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'View' }));
    expect(screen.getByText('Meine Antwort')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Weak in content' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
  });
});

describe('refusals of the preparation', () => {
  it.each([
    ['prepNotAvailable', /once the application has been sent/],
    ['prepReadOnly', /can only be viewed/],
    ['prepExists', /already has questions/],
    ['prepBusy', /still working on this preparation/],
    ['prepNotFinished', /feedback on all questions/],
    ['prepUnreadable', /could not be read/],
  ])('%s explains itself outside the details', async (reason, text) => {
    const user = await openQuestion(view([question(1)]), {
      [ANSWER_ROUTE]: () => ({ status: 409, body: { error: { code: 'CONFLICT', detailsForLog: 'x', reason } } }),
    });
    await user.type(field(), 'Text');
    await user.click(getFeedback());
    const alert = await screen.findByRole('alert');
    expect(alert.querySelector(':scope > p')).toHaveTextContent(text);
    expect(alert.querySelector('strong')).toHaveTextContent('This could not be done right now.');
  });

  it('other conflicts keep their general headline', async () => {
    const user = await openQuestion(view([question(1)]), {
      [ANSWER_ROUTE]: () => ({ status: 409, body: { error: { code: 'CONFLICT', detailsForLog: 'x', reason: 'packageChanged' } } }),
    });
    await user.type(field(), 'Text');
    await user.click(getFeedback());
    expect((await screen.findByRole('alert')).querySelector('strong')).toHaveTextContent('This was changed in the meantime.');
  });
});
