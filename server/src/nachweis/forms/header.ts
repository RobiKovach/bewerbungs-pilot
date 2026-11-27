import type { NachweisAudience, NachweisSetup } from '@bp/shared';
import type { NachweisRow } from '../rows.js';

/** Everything a form's header may show, as printed text (dates DD.MM.YYYY). Fields a setup does not have are ''. */
export interface NachweisHeader {
  personName: string;
  audience: NachweisAudience;
  provider: string;
  measureName: string;
  entry: string;
  exit: string;
  advisor: string;
  officeName: string;
  customerNumber: string;
  /** First – last application date of the rows ('' without rows). */
  period: string;
}

const day = (ymd: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : '';
};

export function toHeader(setup: NachweisSetup, rows: NachweisRow[]): NachweisHeader {
  const m = setup.measure;
  const o = setup.office;
  const first = rows[0]?.appliedAt ?? '';
  const last = rows.at(-1)?.appliedAt ?? '';
  return {
    personName: setup.personName,
    audience: setup.audience,
    provider: m?.provider ?? '',
    measureName: m?.name ?? '',
    entry: day(m?.entry ?? ''),
    exit: day(m?.exit ?? ''),
    advisor: m?.advisor ?? o?.advisor ?? '',
    officeName: o?.name ?? '',
    customerNumber: o?.customerNumber ?? '',
    period: first ? (first === last ? first : `${first} – ${last}`) : '',
  };
}
