import { and, eq, isNotNull } from 'drizzle-orm';
import { schema, type Tx } from '@remix/db';
import { isClassScoped } from '@remix/types';
import type { AuthSession } from '../../common/auth/session-authenticator';

const { staffRoles, classes } = schema;

/**
 * STF-02 — the classes a session may see: `null` for everyone but class-scoped teachers
 * (unrestricted), otherwise the union of the teacher grant's `class_scope` and the classes the
 * teacher is assigned to. An empty array therefore means "no classes at all" (deny by default),
 * never "all classes".
 */
export async function visibleClassIds(tx: Tx, session: AuthSession): Promise<string[] | null> {
  if (!isClassScoped(session.roles)) return null;
  // Sequential: one transaction is one connection, which runs one query at a time.
  const grants = await tx
    .select({ scope: staffRoles.classScope })
    .from(staffRoles)
    .where(
      and(
        eq(staffRoles.userId, session.userId),
        eq(staffRoles.role, 'teacher'),
        isNotNull(staffRoles.classScope),
      ),
    );
  const taught = await tx
    .select({ id: classes.id })
    .from(classes)
    .where(eq(classes.teacherId, session.userId));
  return [...new Set([...grants.flatMap((g) => g.scope ?? []), ...taught.map((c) => c.id)])];
}

/** Postgres SQLSTATE of a (possibly Drizzle-wrapped) driver error, if there is one. */
export function pgErrorCode(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

export const isUniqueViolation = (error: unknown): boolean => pgErrorCode(error) === '23505';
