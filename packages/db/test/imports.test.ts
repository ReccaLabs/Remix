import { sql } from 'drizzle-orm';
import { beforeAll, describe, it } from 'vitest';
import { connectAll, expectPgError } from './support';
import { createWorld, type World } from './tables';

/** Constraints of `import_jobs` (STU-04). */
const db = connectAll();
let w: World;

beforeAll(async () => {
  w = await createWorld(db.owner, 'imports');
});

describe('STU-04 import_jobs', () => {
  it('a finished job must carry its finish time', async () => {
    await expectPgError(
      db.owner.execute(sql`update import_jobs set status = 'done' where id = ${w.importJobId}`),
      '23514',
      /import_jobs_finished_has_time/,
    );
    await db.owner.execute(
      sql`update import_jobs set status = 'done', finished_at = now() where id = ${w.importJobId}`,
    );
  });

  it('rejects an unknown status', async () => {
    await expectPgError(
      db.owner.execute(sql`update import_jobs set status = 'paused' where id = ${w.importJobId}`),
      '22P02',
    );
  });
});
