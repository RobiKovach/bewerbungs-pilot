import type { ErrorReason } from '../types';

/**
 * The server sends machine-readable params with a reason (a raw section id list, an upload "kind"). Turns them into
 * the words a person actually reads, ready for i18next interpolation of `errors.reasons.<reason>`.
 */
export function reasonParams(
  reason: ErrorReason,
  params: Readonly<Record<string, string | number>> | undefined,
  t: (key: string) => string,
): Record<string, string | number> {
  const out: Record<string, string | number> = { ...params };
  if (reason === 'profileMissing' && typeof out.sections === 'string') {
    out.sections = out.sections.split(',').filter(Boolean).map((id) => t(`profile.sections.${id}.title`)).join(', ');
  }
  if (reason === 'fileTypeDetected' && typeof out.kind === 'string') {
    out.allowed = t(`errors.reasons.allowedTypes.${out.kind}`);
  }
  return out;
}
