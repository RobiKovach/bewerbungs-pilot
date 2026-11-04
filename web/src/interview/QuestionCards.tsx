import { useTranslation } from 'react-i18next';
import { KindArt } from './KindArt';
import { isFinished, questionState } from './format';
import type { PrepQuestion } from '../types';

/** The set as cards with a picture by kind; a practical task with code shows the code instead. */
export function QuestionCards({ questions, readOnly, onOpen }: {
  questions: readonly PrepQuestion[];
  readOnly: boolean;
  onOpen: (id: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <ul className="question-cards">
      {questions.map((q) => {
        const state = questionState(q);
        return (
          <li key={q.id} className="question-card" data-testid="question-card">
            {q.code ? <pre className="question-code">{q.code}</pre> : <KindArt kind={q.kind} />}
            <span className="question-card__kind muted">{t(`interview.kind.${q.kind}`)}</span>
            <p className="question-card__text">{q.text}</p>
            <div className="question-card__foot">
              <span className={state === 'weak' ? 'badge warn' : 'badge'}>{t(`interview.state.${state}`)}</span>
              <button type="button" className="btn ghost" onClick={() => onOpen(q.id)}>
                {t(readOnly || isFinished(q) ? 'interview.view' : 'interview.answer')}
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
