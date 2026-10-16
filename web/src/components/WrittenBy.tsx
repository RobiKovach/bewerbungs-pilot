import { useTranslation } from 'react-i18next';
import { AI_NAMES } from '../i18n';
import type { ProviderId } from '../types';

export function WrittenBy({ provider, kind }: { provider: ProviderId; kind: 'package' | 'score' }) {
  const { t } = useTranslation();
  const name = AI_NAMES[provider];
  return (
    <span className="badge written-by" title={t(kind === 'package' ? 'writtenBy.tipPackage' : 'writtenBy.tipScore', { name })}>
      {t('writtenBy.label', { name })}
    </span>
  );
}
