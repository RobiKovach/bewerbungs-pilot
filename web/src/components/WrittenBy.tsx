import { useTranslation } from 'react-i18next';
import { AI_NAMES } from '../i18n';
import type { ProviderId } from '../types';

const TIPS = { package: 'writtenBy.tipPackage', score: 'writtenBy.tipScore', research: 'writtenBy.tipResearch' } as const;

export function WrittenBy({ provider, kind }: { provider: ProviderId; kind: 'package' | 'score' | 'research' }) {
  const { t } = useTranslation();
  const name = AI_NAMES[provider];
  return (
    <span className="badge written-by" title={t(TIPS[kind], { name })}>
      {t('writtenBy.label', { name })}
    </span>
  );
}
