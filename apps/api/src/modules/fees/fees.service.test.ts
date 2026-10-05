import { describe, expect, it, vi } from 'vitest';
import type { Db } from '@remix/db';
import { AuditService } from '../audit/audit.service';
import { ManualClock } from '../../common/time/clock';
import { FeesHooks } from './fees-hooks';
import { FeesService } from './fees.service';

describe('myFees defence in depth (FEE-10)', () => {
  it('refuses non-student sessions before any database access', async () => {
    const transaction = vi.fn();
    const db = { transaction } as unknown as Db;
    const service = new FeesService(db, new ManualClock(new Date()), new AuditService(), new FeesHooks());
    for (const kind of ['staff', 'platform'] as const) {
      await expect(service.myFees('tenant', { kind, userId: 'user', tenantId: 'tenant', sessionId: 'session', roles: ['owner'] })).rejects.toMatchObject({ status: 403 });
    }
    expect(transaction).not.toHaveBeenCalled();
  });
});
