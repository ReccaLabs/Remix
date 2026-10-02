import 'server-only';
import type { ClassSummary } from '@remix/types/api';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { TENANT_PATHS } from '@/lib/paths';
import { getApi, problemCode } from './api';
import { getRequestContext } from './request';

export type MyClassesResult = { ok: true; items: ClassSummary[] } | { ok: false };

/**
 * The signed-in student's classes (GET /api/v1/me/classes), cached per request. A session that
 * ended since the layout checked it → login; any other failure becomes an in-page error state
 * instead of an error page, so the shell and navigation stay usable.
 */
export const loadMyClasses = cache(async (): Promise<MyClassesResult> => {
  try {
    const { items } = await (await getApi()).call('myClasses');
    return { ok: true, items };
  } catch (err) {
    const code = problemCode(err);
    if (code === 'UNAUTHENTICATED') redirect(TENANT_PATHS.studentLogin);
    // Code and request id only — never the session, cookie or response body.
    const { requestId } = await getRequestContext();
    console.error('GET /me/classes failed', { code: code ?? 'NO_PROBLEM_RESPONSE', requestId });
    return { ok: false };
  }
});
