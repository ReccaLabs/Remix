import { describe, expect, it, vi } from 'vitest';
import type { AuthNotifications } from '../auth/auth-notifications';
import { PeopleHooks } from './people-hooks';
import { PeopleModule } from './people.module';
import { isUniqueViolation, pgErrorCode } from './scope';
import { monthBefore, studentStatus } from './students.service';

describe('studentStatus', () => {
  it('archived beats invited beats active; disabled accounts read as active', () => {
    const at = new Date();
    expect(studentStatus(at, 'invited')).toBe('archived');
    expect(studentStatus(null, 'invited')).toBe('invited');
    expect(studentStatus(null, 'active')).toBe('active');
    expect(studentStatus(null, 'disabled')).toBe('active');
  });
});

describe('monthBefore', () => {
  it('steps back one month, across year boundaries', () => {
    expect(monthBefore('2026-11-01')).toBe('2026-10-01');
    expect(monthBefore('2026-01-01')).toBe('2025-12-01');
    expect(monthBefore('2024-03-01')).toBe('2024-02-01');
  });
});

describe('pgErrorCode', () => {
  it('finds the SQLSTATE under Drizzle’s wrapper and ignores other errors', () => {
    const wrapped = Object.assign(new Error('Failed query'), {
      cause: Object.assign(new Error('duplicate key'), { code: '23505' }),
    });
    expect(pgErrorCode(wrapped)).toBe('23505');
    expect(isUniqueViolation(wrapped)).toBe(true);
    expect(isUniqueViolation(new Error('boom'))).toBe(false);
    expect(pgErrorCode(Object.assign(new Error('x'), { code: 'ECONNRESET' }))).toBeNull();
    expect(pgErrorCode(null)).toBeNull();
  });
});

describe('PeopleHooks', () => {
  const student = { tenantId: 't', studentId: 's', displayName: 'N', phone: '+94771234567' };
  const staff = {
    tenantId: 't',
    inviteId: 'i',
    token: 'secret-token',
    displayName: 'N',
    phone: null,
    email: 'n@example.test',
    role: 'teacher' as const,
    expiresAt: new Date(),
  };

  it('does nothing until a handler is registered', async () => {
    const hooks = new PeopleHooks();
    await expect(hooks.onStudentInvited(student)).resolves.toBeUndefined();
    await expect(hooks.onStaffInvited(staff)).resolves.toBeUndefined();
  });

  it('calls every registered handler with the event', async () => {
    const hooks = new PeopleHooks();
    const a = vi.fn();
    const b = vi.fn();
    hooks.registerStaffInvited(a);
    hooks.registerStaffInvited(b);
    await hooks.onStaffInvited(staff);
    expect(a).toHaveBeenCalledWith(staff);
    expect(b).toHaveBeenCalledWith(staff);
  });

  it('swallows handler failures and never logs the event (it carries the token)', async () => {
    const hooks = new PeopleHooks();
    const after = vi.fn();
    hooks.registerStaffInvited(() => {
      throw new Error(`queue down for ${staff.token}`);
    });
    hooks.registerStaffInvited(after);
    const logged: string[] = [];
    const logger = (hooks as unknown as { logger: { error: (m: string) => void } }).logger;
    logger.error = (m) => logged.push(m);
    await hooks.onStaffInvited(staff);
    expect(after).toHaveBeenCalledOnce();
    expect(logged).toHaveLength(1);
    expect(logged[0]).not.toContain(staff.token);
  });
});

describe('PeopleModule wiring', () => {
  it('routes both hooks to AuthNotifications (sms queue delivery)', async () => {
    const notifications = {
      onStudentInvited: vi.fn().mockResolvedValue(true),
      onStaffInvited: vi.fn().mockResolvedValue(true),
    };
    const hooks = new PeopleHooks();
    new PeopleModule(hooks, notifications as unknown as AuthNotifications).onModuleInit();

    await hooks.onStudentInvited({
      tenantId: 't',
      studentId: 's',
      displayName: 'N',
      phone: '+94771234567',
    });
    expect(notifications.onStudentInvited).toHaveBeenCalledWith('t', 's');

    await hooks.onStaffInvited({
      tenantId: 't',
      inviteId: 'i',
      token: 'tok',
      displayName: 'N',
      phone: '+94771234567',
      email: null,
      role: 'teacher',
      expiresAt: new Date(),
    });
    expect(notifications.onStaffInvited).toHaveBeenCalledWith('t', {
      id: 'i',
      phone: '+94771234567',
      token: 'tok',
    });
  });

  it('registers nothing when the auth module is absent', async () => {
    const hooks = new PeopleHooks();
    new PeopleModule(hooks).onModuleInit();
    await expect(
      hooks.onStudentInvited({
        tenantId: 't',
        studentId: 's',
        displayName: 'N',
        phone: '+94771234567',
      }),
    ).resolves.toBeUndefined();
  });
});
