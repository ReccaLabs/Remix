import { describe, expect, it } from 'vitest';
import { createRequestContext, type RequestContext } from '../context/request-context';
import { belongsToHost } from './auth.guard';
import type { AuthSession } from './session-authenticator';

const A = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
const B = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c';

function ctx(area: RequestContext['area'], tenantId: string | null): RequestContext {
  const c = createRequestContext({
    requestId: 'r',
    host: 'h',
    protocol: 'https',
    origin: 'https://h',
    clientIp: null,
  });
  c.area = area;
  c.tenant = tenantId ? { id: tenantId, slug: 's', status: 'active' } : null;
  return c;
}

const session = (kind: AuthSession['kind'], tenantId: string | null): AuthSession => ({
  sessionId: 's',
  userId: 'u',
  tenantId,
  kind,
  roles: [],
});

describe('belongsToHost', () => {
  it('accepts a tenant session on its own tenant host', () => {
    expect(belongsToHost(session('student', A), ctx('tenant', A))).toBe(true);
    expect(belongsToHost(session('staff', A), ctx('tenant', A))).toBe(true);
  });

  it("rejects another tenant's session", () => {
    expect(belongsToHost(session('student', B), ctx('tenant', A))).toBe(false);
  });

  it('rejects platform sessions on tenant hosts and tenant sessions on the platform host', () => {
    expect(belongsToHost(session('platform', null), ctx('tenant', A))).toBe(false);
    expect(belongsToHost(session('staff', A), ctx('platform', null))).toBe(false);
    expect(belongsToHost(session('platform', null), ctx('platform', null))).toBe(true);
  });

  it('rejects every session on host-independent routes', () => {
    expect(belongsToHost(session('student', A), ctx(null, null))).toBe(false);
  });
});
