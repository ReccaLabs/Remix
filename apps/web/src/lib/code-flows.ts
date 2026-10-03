import type { OtpPurpose } from '@remix/types/api';

/** URL segment → SMS-code purpose and its message key (`auth.code.<key>`). */
export interface CodeFlowDef {
  key: 'forgot' | 'first' | 'unlock';
  purpose: OtpPurpose;
}

export const STUDENT_CODE_FLOWS: readonly CodeFlowDef[] = [
  { key: 'forgot', purpose: 'password_reset' },
  { key: 'first', purpose: 'first_password' },
  { key: 'unlock', purpose: 'unlock' },
];

/** Staff are invited with a link (AUTH-07), so they have no "first password" code flow. */
export const STAFF_CODE_FLOWS: readonly CodeFlowDef[] = [
  { key: 'forgot', purpose: 'password_reset' },
  { key: 'unlock', purpose: 'unlock' },
];

/** The flow for a URL segment, or null (→ 404). */
export function codeFlowPurpose(
  segment: string,
  flows: readonly CodeFlowDef[],
): CodeFlowDef | null {
  return flows.find((f) => f.key === segment) ?? null;
}
