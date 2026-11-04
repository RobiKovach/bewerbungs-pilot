import type { PrepKind } from '../types';

const PATHS: Record<PrepKind, React.ReactNode> = {
  experience: (<><circle cx="12" cy="8" r="4" /><path d="M4 21c1-5 4-7 8-7s7 2 8 7" /></>),
  theory: <path d="M12 6c-2-1.5-5-2-8-2v15c3 0 6 .5 8 2 2-1.5 5-2 8-2V4c-3 0-6 .5-8 2zM12 6v15" />,
  practice: <path d="M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16" />,
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
