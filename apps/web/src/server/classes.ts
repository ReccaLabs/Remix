import 'server-only';
import {
  ApiError,
  type AdminClass,
  type ClassDetail,
  type ClassStudent,
  type DashboardResponse,
  type Hall,
  type TimetableResponse,
} from '@remix/types/api';
import { notFound, redirect } from 'next/navigation';
import { cache } from 'react';
import { TENANT_PATHS } from '@/lib/paths';
import { teachersOf, type ClassesQuery } from '@/lib/classes';
import { getApi, problemCode } from './api';
import { getRequestContext } from './request';

/**
 * Server-side loaders of the admin Classes, timetable and dashboard screens. Same rules as
 * `server/people.ts`: a session that ended goes back to the login, a missing or foreign class is
 * the 404 page, anything else is `{ ok: false }` so the page shows an in-page error.
 */

export type Loaded<T> = { ok: true; data: T } | { ok: false };

async function failed(what: string, err: unknown): Promise<{ ok: false }> {
  const code = problemCode(err);
  if (code === 'UNAUTHENTICATED') redirect(TENANT_PATHS.staffLogin);
  const { requestId } = await getRequestContext();
  console.error(`${what} failed`, { code: code ?? 'NO_PROBLEM_RESPONSE', requestId });
  return { ok: false };
}

export async function loadClasses(query: ClassesQuery): Promise<Loaded<{ items: AdminClass[] }>> {
  try {
    return { ok: true, data: await (await getApi()).call('listClasses', { query }) };
  } catch (err) {
    return failed('GET /admin/classes', err);
  }
}

/** One class; 404/400 from the API (unknown, other institute, outside a teacher's scope) → 404 page. */
export const loadClass = cache(async (id: string): Promise<Loaded<ClassDetail>> => {
  try {
    return { ok: true, data: await (await getApi()).call('getClass', { params: { id } }) };
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 400)) notFound();
    return failed('GET /admin/classes/:id', err);
  }
});

export async function loadClassStudents(id: string): Promise<Loaded<ClassStudent[]>> {
  try {
    const { items } = await (await getApi()).call('classStudents', { params: { id } });
    return { ok: true, data: items };
  } catch (err) {
    return failed('GET /admin/classes/:id/students', err);
  }
}

export async function loadHalls(): Promise<Loaded<Hall[]>> {
  try {
    const { items } = await (await getApi()).call('listHalls');
    return { ok: true, data: items };
  } catch (err) {
    return failed('GET /admin/halls', err);
  }
}

/** Halls for a picker; any failure yields an empty list (the form still works without halls). */
export const loadHallOptions = cache(async (): Promise<Hall[]> => {
  try {
    return (await (await getApi()).call('listHalls')).items;
  } catch {
    return [];
  }
});

/**
 * People who can teach a class. Listing staff needs `staff.manage` (owners); for everyone else
 * (admins) the teachers already assigned to classes are the best list the API offers.
 */
export const loadTeacherOptions = cache(async (): Promise<{ id: string; name: string }[]> => {
  const api = await getApi();
  try {
    const { items } = await api.call('listStaff');
    return items
      .filter((m) => m.status === 'active' && m.roles.includes('teacher'))
      .map((m) => ({ id: m.id, name: m.displayName }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    try {
      const { items } = await api.call('listClasses', { query: {} });
      return teachersOf(items);
    } catch {
      return [];
    }
  }
});

export async function loadTimetable(weekStart: string): Promise<Loaded<TimetableResponse>> {
  try {
    return { ok: true, data: await (await getApi()).call('timetable', { query: { weekStart } }) };
  } catch (err) {
    return failed('GET /admin/timetable', err);
  }
}

export async function loadDashboard(): Promise<Loaded<DashboardResponse>> {
  try {
    return { ok: true, data: await (await getApi()).call('dashboard') };
  } catch (err) {
    return failed('GET /admin/dashboard', err);
  }
}
