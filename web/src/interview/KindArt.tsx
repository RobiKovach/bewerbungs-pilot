import type { PrepKind } from '../types';

const PATHS: Record<PrepKind, React.ReactNode> = {
  experience: (<><circle cx="12" cy="8" r="4" /><path d="M4 21c1-5 4-7 8-7s7 2 8 7" /></>),
  theory: <path d="M12 6c-2-1.5-5-2-8-2v15c3 0 6 .5 8 2 2-1.5 5-2 8-2V4c-3 0-6 .5-8 2zM12 6v15" />,
  // A checklist, not code symbols: practical tasks exist in every trade, and real code is shown as text instead of a picture.
  practice: <path d="M10 6h10M10 12h10M10 18h10M4 6l1.5 1.5L8 5M4 12l1.5 1.5L8 11M4 18l1.5 1.5L8 17" />,
};

/** The picture on a question card: built in (no network, no photos), it shows the kind of question. */
export function KindArt({ kind }: { kind: PrepKind }) {
  return (
    <div className={`question-art question-art--${kind}`} aria-hidden="true">
      <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {PATHS[kind]}
      </svg>
    </div>
  );
}
