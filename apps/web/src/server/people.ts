import 'server-only';
import {
  ApiError,
  type AdminClass,
  type ListStudentsResponse,
  type StaffResponse,
  type StudentProfile,
} from '@remix/types/api';
import { notFound, redirect } from 'next/navigation';
import { cache } from 'react';
import { TENANT_PATHS } from '@/lib/paths';
import type { ListQuery } from '@/lib/people';
import { getApi, problemCode } from './api';
import { getRequestContext } from './request';

/**
 * Server-side loaders of the admin people screens. A session that ended since the layout checked
 * it goes back to the login; any other failure is returned as `{ ok: false }` so the page can
 * show an in-page error and keep the shell usable. Only the error code and request id are
 * logged — never a body, cookie or personal data.
 */

export type Loaded<T> = { ok: true; data: T } | { ok: false };

async function failed(what: string, err: unknown): Promise<{ ok: false }> {
  const code = problemCode(err);
  if (code === 'UNAUTHENTICATED') redirect(TENANT_PATHS.staffLogin);
  const { requestId } = await getRequestContext();
  console.error(`${what} failed`, { code: code ?? 'NO_PROBLEM_RESPONSE', requestId });
  return { ok: false };
}

export async function loadStudents(query: ListQuery): Promise<Loaded<ListStudentsResponse>> {
  try {
    return { ok: true, data: await (await getApi()).call('listStudents', { query }) };
  } catch (err) {
    return failed('GET /admin/students', err);
  }
}

/** One profile; 404 from the API (unknown, other institute, outside a teacher's scope) → 404 page. */
export const loadStudent = cache(async (id: string): Promise<Loaded<StudentProfile>> => {
  try {
    return { ok: true, data: await (await getApi()).call('getStudent', { params: { id } }) };
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 400)) notFound();
    return failed('GET /admin/students/:id', err);
  }
});

export async function loadStaff(): Promise<Loaded<StaffResponse>> {
  try {
    return { ok: true, data: await (await getApi()).call('listStaff') };
  } catch (err) {
    return failed('GET /admin/staff', err);
  }
}

/**
 * Classes for filters and pickers (Phase 2 track C owns the endpoint). Any failure — including
 * "not there yet" — yields an empty list: the people screens work without class pickers.
 */
export const loadClassOptions = cache(async (): Promise<Pick<AdminClass, 'id' | 'name'>[]> => {
  try {
    const { items } = await (await getApi()).call('listClasses', { query: {} });
    return items.filter((c) => !c.archivedAt).map(({ id, name }) => ({ id, name }));
  } catch {
    return [];
  }
});
