import { sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../src/tenant';
import { connectAll, expectPgError, rolledBack, Rollback } from './support';
import { createWorld, type World } from './tables';

/** FEE-05/06 + ADR 0009: constraints and lifecycle guards beyond the generated isolation suite. */
const db = connectAll();
let a: World;
let b: World;
beforeAll(async () => {
  [a, b] = await Promise.all([createWorld(db.owner, 'slips-a'), createWorld(db.owner, 'slips-b')]);
});

const app = <T>(w: World, work: Parameters<typeof withTenant<T>>[2]) => withTenant(db.app, w.tenantId, work);
const insertUpload = (w: World, objectKey: string, extra = sql``) =>
  app(w, (tx) =>
    tx.execute(sql`insert into uploads (tenant_id, kind, created_by, content_type, size_bytes, object_key)
      values (${w.tenantId}::uuid, 'slip', ${w.studentUserId}::uuid, 'image/jpeg', 100, ${objectKey}) ${extra}`),
  );
const insertSlip = (w: World, uploadId: string, reference = 'ab 12 c', norm = 'AB12C') =>
  app(w, (tx) =>
    tx.execute(sql`insert into bank_slips (tenant_id, student_id, upload_id, amount_cents, reference, reference_norm, slip_date)
      values (${w.tenantId}::uuid, ${w.studentUserId}::uuid, ${uploadId}::uuid, 250000, ${reference}, ${norm}, '2026-10-02')
      returning id`),
  );

describe('uploads', () => {
  it('keeps object keys under the tenant prefix and bounds type and size', async () => {
    await expectPgError(insertUpload(a, `${b.tenantId}/slips/x.jpg`), '23514');
    await expectPgError(insertUpload(a, 'slips/x.jpg'), '23514');
    await expectPgError(
      app(a, (tx) =>
        tx.execute(sql`insert into uploads (tenant_id, kind, created_by, content_type, size_bytes, object_key)
          values (${a.tenantId}::uuid, 'slip', ${a.studentUserId}::uuid, 'image/gif', 100, ${`${a.tenantId}/x.gif`})`),
      ),
      '23514',
    );
    await expectPgError(
      app(a, (tx) =>
        tx.execute(sql`insert into uploads (tenant_id, kind, created_by, content_type, size_bytes, object_key)
          values (${a.tenantId}::uuid, 'slip', ${a.studentUserId}::uuid, 'image/png', 5242881, ${`${a.tenantId}/x.png`})`),
      ),
      '23514',
    );
  });

  it('moves pending → processed once, then freezes; only pending rows can be deleted', async () => {
    await rolledBack(
      app(a, async (tx) => {
        const processed = `${a.tenantId}/slips/2026/10/p.jpg`;
        await tx.execute(sql`update uploads set status = 'processed', processed_key = ${processed}, processed_at = now() where id = ${a.uploadId}::uuid`);
        await expectPgError(tx.execute(sql`update uploads set status = 'pending', processed_key = null, processed_at = null where id = ${a.uploadId}::uuid`), '23514');
        throw new Rollback();
      }),
    );
    await expectPgError(
      app(a, (tx) => tx.execute(sql`update uploads set status = 'processed', processed_key = ${`${b.tenantId}/x.jpg`}, processed_at = now() where id = ${a.uploadId}::uuid`)),
      '23514',
    );
    await expectPgError(
      app(a, (tx) => tx.execute(sql`update uploads set status = 'processed', processed_at = now() where id = ${a.uploadId}::uuid`)),
      '23514',
    );
    await expectPgError(
      app(a, (tx) => tx.execute(sql`delete from uploads where status = 'processed'`)),
      '23514',
    );
    for (const column of ['object_key', 'content_type', 'size_bytes', 'created_by', 'kind', 'created_at']) {
      await expectPgError(
        app(a, (tx) => tx.execute(sql`update uploads set ${sql.identifier(column)} = ${sql.identifier(column)}`)),
        '42501',
      );
    }
  });
});

describe('bank_slips', () => {
  it('requires the normalised reference to match and the amount to be positive', async () => {
    await expectPgError(insertSlip(a, a.uploadId, 'ab 12 c', 'ab12c'), '23514');
    await expectPgError(insertSlip(a, a.uploadId, 'ab', 'AB'), '23514');
    await rolledBack(
      app(a, async (tx) => {
        await tx.execute(sql`insert into bank_slips (tenant_id, student_id, upload_id, amount_cents, reference, reference_norm, slip_date)
          values (${a.tenantId}::uuid, ${a.studentUserId}::uuid, ${a.uploadId}::uuid, 1, 'tx 1 2', 'TX12', '2026-10-02')`);
        throw new Rollback();
      }),
    );
    await expectPgError(
      app(a, (tx) =>
        tx.execute(sql`insert into bank_slips (tenant_id, student_id, upload_id, amount_cents, reference, reference_norm, slip_date)
          values (${a.tenantId}::uuid, ${a.studentUserId}::uuid, ${a.uploadId}::uuid, 0, 'tx 1 2', 'TX12', '2026-10-02')`),
      ),
      '23514',
    );
    // A new slip starts as `processing`; status and review columns are not insertable.
    await expectPgError(
      app(a, (tx) =>
        tx.execute(sql`insert into bank_slips (tenant_id, student_id, upload_id, amount_cents, reference, reference_norm, slip_date, status)
          values (${a.tenantId}::uuid, ${a.studentUserId}::uuid, ${a.uploadId}::uuid, 10, 'tx 1 2', 'TX12', '2026-10-02', 'approved')`),
      ),
      '42501',
    );
  });

  it('allows only forward status changes with matching review fields; final states are frozen', async () => {
    const reject = (id: string) =>
      sql`update bank_slips set status = 'rejected', reject_reason = 'Unreadable file', reviewed_at = now() where id = ${id}::uuid`;
    await rolledBack(
      app(a, async (tx) => {
        await tx.execute(reject(a.slipId));
        await expectPgError(tx.execute(sql`update bank_slips set status = 'submitted', reject_reason = null where id = ${a.slipId}::uuid`), '23514');
        throw new Rollback();
      }),
    );
    // approved needs a payment; rejected needs a reason; submitted cannot go back to processing.
    await expectPgError(app(a, (tx) => tx.execute(sql`update bank_slips set status = 'approved', reviewed_at = now() where id = ${a.slipId}::uuid`)), '23514');
    await expectPgError(app(a, (tx) => tx.execute(sql`update bank_slips set status = 'rejected', reviewed_at = now() where id = ${a.slipId}::uuid`)), '23514');
    await expectPgError(app(a, (tx) => tx.execute(sql`update bank_slips set status = 'processing' where id = ${a.slipId}::uuid`)), '23514');
    await expectPgError(app(a, (tx) => tx.execute(sql`update bank_slips set duplicate_confirmed = true where id = ${a.slipId}::uuid`)), '23514');
    await rolledBack(
      app(a, async (tx) => {
        await tx.execute(sql`update bank_slips set status = 'approved', payment_id = ${a.sparePaymentId}::uuid, reviewed_by = ${a.staffUserId}::uuid, reviewed_at = now(), duplicate_confirmed = true where id = ${a.slipId}::uuid`);
        await expectPgError(tx.execute(sql`update bank_slips set reviewed_by = null where id = ${a.slipId}::uuid`), '23514');
        throw new Rollback();
      }),
    );
    // Cross-tenant review references are rejected by the composite keys.
    await expectPgError(
      app(a, (tx) => tx.execute(sql`update bank_slips set status = 'approved', payment_id = ${b.sparePaymentId}::uuid, reviewed_at = now() where id = ${a.slipId}::uuid`)),
      '23503',
    );
    await expectPgError(
      app(a, (tx) => tx.execute(sql`update bank_slips set reviewed_by = ${b.staffUserId}::uuid, reviewed_at = now() where id = ${a.slipId}::uuid`)),
      '23503',
    );
    for (const column of ['student_id', 'upload_id', 'amount_cents', 'reference', 'reference_norm', 'slip_date', 'submitted_at']) {
      await expectPgError(
        app(a, (tx) => tx.execute(sql`update bank_slips set ${sql.identifier(column)} = ${sql.identifier(column)}`)),
        '42501',
      );
    }
    await expectPgError(app(a, (tx) => tx.execute(sql`delete from bank_slips`)), '42501');
  });
});

describe('bank_slip_lines', () => {
  it('is insert-only', async () => {
    await expectPgError(app(a, (tx) => tx.execute(sql`update bank_slip_lines set slip_id = slip_id`)), '42501');
    await expectPgError(app(a, (tx) => tx.execute(sql`delete from bank_slip_lines`)), '42501');
  });

  it('rejects a link to another student of the same tenant', async () => {
    // Give the spare user a students row (as owner, in A's context), then try to link A's line
    // to a slip of that spare student.
    await rolledBack(
      db.owner.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.tenant_id', ${a.tenantId}, true)`);
        await tx.execute(sql`insert into students (tenant_id, user_id, student_no) values (${a.tenantId}::uuid, ${a.spareStudentUserId}::uuid, 'IS-0777')`);
        const [slip] = (
          await tx.execute<{ id: string }>(sql`insert into bank_slips (tenant_id, student_id, upload_id, amount_cents, reference, reference_norm, slip_date)
            values (${a.tenantId}::uuid, ${a.spareStudentUserId}::uuid, ${a.uploadId}::uuid, 10, 'abc', 'ABC', '2026-10-02') returning id`)
        ).rows;
        await expectPgError(
          tx.execute(sql`insert into bank_slip_lines (tenant_id, slip_id, invoice_line_id) values (${a.tenantId}::uuid, ${slip?.id ?? ''}::uuid, ${a.lineId}::uuid)`),
          '23514',
          /slip's student/,
        );
        throw new Rollback();
      }),
    );
  });
});
