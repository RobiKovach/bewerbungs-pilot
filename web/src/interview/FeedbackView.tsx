import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { PrepAnswer, PrepFeedback } from '../types';

function Block({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className="feedback-block" aria-labelledby={id}>
      <h3 id={id}>{title}</h3>
      {children}
    </section>
  );
}

/** The person's answer, then the three blocks of the spec. Examples and the better answer are in the language of the interview. */
export function FeedbackView({ answer, feedback, language }: { answer: PrepAnswer; feedback: PrepFeedback; language: 'de' | 'en' }) {
  const { t } = useTranslation();
  return (
    <>
      <p className={feedback.weak ? 'badge warn' : 'badge'}>{t(`interview.state.${feedback.weak ? 'weak' : 'done'}`)}</p>
      <YourAnswer answer={answer} />
      <Block title={t(feedback.weak ? 'interview.feedback.content' : 'interview.feedback.contentOk')}>
        <p className="prep-text">{feedback.content}</p>
      </Block>
      <Block title={t('interview.feedback.language')}>
        {feedback.languageFixes.length > 0 ? (
          <ul className="language-fixes">
            {feedback.languageFixes.map((fix) => (
              <li key={`${fix.said}|${fix.correct}`}>
                <span lang={language}><s>{fix.said}</s></span> → <strong lang={language}>{fix.correct}</strong>
                <p className="muted prep-text">{fix.why}</p>
              </li>
            ))}
          </ul>
        ) : <p>{t(answer.dontKnow ? 'interview.feedback.noAnswerToCheck' : 'interview.feedback.noFixes')}</p>}
      </Block>
      <Block title={t('interview.feedback.better')}>
        <p className="prep-text" lang={language}>{feedback.better}</p>
      </Block>
    </>
  );
}

export function YourAnswer({ answer }: { answer: PrepAnswer }) {
  const { t } = useTranslation();
  return (
    <Block title={t('interview.yourAnswer')}>
      {answer.dontKnow ? <p className="muted">{t('interview.saidDontKnow')}</p> : <p className="prep-text">{answer.text}</p>}
    </Block>
  );
}
