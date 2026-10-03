import type { IncomingMessage } from 'node:http';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS, ROLE_PERMISSIONS } from '@remix/types';
import { STAFF_ROLES, type StaffRole } from '@remix/types/api';
import { describe, expect, it } from 'vitest';
import { attachContext, createRequestContext } from '../context/request-context';
import { AppException } from '../errors/app-exception';
import { RequirePermission } from './auth.decorators';
import { PermissionGuard } from './permission.guard';
import type { AuthSession } from './session-authenticator';

class Controller {
  @RequirePermission('students.write')
  write(): void {}

  @RequirePermission('students.read', 'students.devices')
  both(): void {}

  open(): void {}
}

const guard = new PermissionGuard(new Reflector());
const method = (proto: object, name: string): (() => void) => {
  const fn: unknown = Reflect.get(proto, name);
  return fn as () => void;
};
const handlerOf = (name: 'write' | 'both' | 'open') => method(Controller.prototype, name);

function contextFor(handler: () => void, session: AuthSession | null): ExecutionContext {
  const ctx = createRequestContext({
    requestId: 'r',
    host: 'h',
    protocol: 'https',
    origin: 'https://h',
    clientIp: null,
  });
  ctx.session = session;
  const req = {} as IncomingMessage;
  attachContext(req, ctx);
  return {
    getType: () => 'http',
    getHandler: () => handler,
    getClass: () => Controller,
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

const staff = (...roles: StaffRole[]): AuthSession => ({
  sessionId: 's',
  userId: 'u',
  tenantId: 't',
  kind: 'staff',
  roles,
});

const run = (handler: () => void, session: AuthSession | null) => () =>
  guard.canActivate(contextFor(handler, session));

describe('PermissionGuard', () => {
  it('lets routes without @RequirePermission through', () => {
    expect(run(handlerOf('open'), null)()).toBe(true);
  });

  it('answers 401 without a session', () => {
    expect(run(handlerOf('write'), null)).toThrow(
      expect.objectContaining({ code: 'UNAUTHENTICATED', status: 401 }),
    );
  });

  it.each(STAFF_ROLES)('%s: allowed exactly when the role table grants the permission', (role) => {
    for (const permission of PERMISSIONS) {
      class Probe {
        @RequirePermission(permission)
        go(): void {}
      }
      const probe = new PermissionGuard(new Reflector());
      const context = {
        ...contextFor(method(Probe.prototype, 'go'), staff(role)),
        getClass: () => Probe,
      } as unknown as ExecutionContext;
      const expected = ROLE_PERMISSIONS[role].includes(permission);
      if (expected) expect(probe.canActivate(context)).toBe(true);
      else expect(() => probe.canActivate(context)).toThrow(AppException);
    }
  });

  it('refuses students and platform sessions even when roles are somehow present', () => {
    for (const kind of ['student', 'platform'] as const) {
      const session: AuthSession = { ...staff('owner'), kind };
      expect(run(handlerOf('write'), session)).toThrow(
        expect.objectContaining({ code: 'FORBIDDEN', status: 403 }),
      );
    }
  });

  it('requires every listed permission', () => {
    // Teachers read students but have no device permission.
    expect(run(handlerOf('both'), staff('teacher'))).toThrow(AppException);
    expect(run(handlerOf('both'), staff('admin'))()).toBe(true);
  });

  it('combines roles: a cashier who is also an admin may write', () => {
    expect(run(handlerOf('write'), staff('cashier'))).toThrow(AppException);
    expect(run(handlerOf('write'), staff('cashier', 'admin'))()).toBe(true);
  });
});
