import { describe, expect, it } from 'vitest';
import type { schema } from '@remix/db';
import { studentCardSchema } from '@remix/types/api';
import { presentCard } from './cards.service';

describe('STU-06 card response projection', () => {
  it('returns only contract fields and the last four UID characters', () => {
    const row: typeof schema.studentCards.$inferSelect = {
      id: '0193f1c2-7b1d-7c3e-9a4f-000000000001',
      tenantId: '0193f1c2-7b1d-7c3e-9a4f-000000000002',
      studentId: '0193f1c2-7b1d-7c3e-9a4f-000000000003',
      cardSeq: 1,
      code: 'NIL-26-0042-1',
      kind: 'permanent',
      formats: ['barcode', 'qr', 'nfc'],
      nfcUid: '04A21B9C',
      status: 'active',
      issuedAt: new Date('2026-10-05T10:00:00Z'),
      issuedBy: '0193f1c2-7b1d-7c3e-9a4f-000000000004',
      activatedAt: new Date('2026-10-05T11:00:00Z'),
      activatedBy: '0193f1c2-7b1d-7c3e-9a4f-000000000004',
      revokedAt: null,
      revokedBy: null,
      revokeReason: null,
    };
    const result = studentCardSchema.strict().parse(presentCard(row));
    expect(result.nfcUidHint).toBe('\u2022\u2022\u2022\u20221B9C');
    expect(JSON.stringify(result)).not.toContain('04A21B9C');
    expect(presentCard({ ...row, nfcUid: null }).nfcUidHint).toBeNull();
  });
});
