import { useTranslation } from 'react-i18next';

/** `demo`: the demo copy was closed; the person goes back to the tab of the real app. */
export function QuitScreen({ demo = false }: { demo?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="boot">
      <div className="card">
        <h1>{t(demo ? 'quit.demoTitle' : 'quit.title')}</h1>
        <p>{t(demo ? 'quit.demoBody' : 'quit.body')}</p>
      </div>
    </div>
  );
}
