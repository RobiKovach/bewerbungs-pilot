import { api } from '../api';

/** The server's own HTML of the document, exactly as it will be printed. No scripts: sandbox with no permissions. */
export function PreviewFrame({ id, kind, version, title }: { id: string; kind: 'letter' | 'cv'; version: string; title: string }) {
  return <iframe className="preview-frame" title={title} sandbox="" src={api.previewUrl(id, kind, version)} />;
}
