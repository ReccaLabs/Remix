import { describe, expect, it } from 'vitest';
import {
  contextLogFields,
  createRequestContext,
  currentContext,
  requireContext,
  runWithContext,
} from './request-context';

describe('request context', () => {
  const ctx = createRequestContext({
    requestId: 'r1',
    host: 'kamal.remix.lk',
    protocol: 'https',
    origin: 'https://kamal.remix.lk',
    clientIp: '203.0.113.7',
  });

  it('is visible inside runWithContext, across awaits, and nowhere else', async () => {
    expect(currentContext()).toBeUndefined();
    expect(() => requireContext()).toThrow(/outside an HTTP request/);
    await runWithContext(ctx, async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      expect(requireContext()).toBe(ctx);
    });
    expect(currentContext()).toBeUndefined();
  });

  it('log fields are ids only — never host or IP', () => {
    ctx.tenant = { id: 't1', slug: 'kamal', status: 'active' };
    ctx.session = { sessionId: 's', userId: 'u1', tenantId: 't1', kind: 'student', roles: [] };
    expect(contextLogFields(ctx)).toEqual({ requestId: 'r1', tenantId: 't1', userId: 'u1' });
    expect(contextLogFields(undefined)).toEqual({});
  });
});
