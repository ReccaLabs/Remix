import { describe, expect, it } from 'vitest';
import { JOBS, prepareJob, QUEUES } from './queues';

const TENANT = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
const sms = {
  tenantId: TENANT,
  messageId: 'msg_1',
  gateway: 'remix-wallet',
  senderId: 'ReMix',
  to: '+94771234567',
  text: 'Your code is 123456',
};

describe('queue definitions', () => {
  it('defines every queue name', () => {
    expect(Object.keys(JOBS).sort()).toEqual([...QUEUES].sort());
  });

  it('derives the sms job id from tenant and message id (the business key)', () => {
    expect(prepareJob('sms', sms).jobId).toBe(`sms-${TENANT}-msg_1`);
    expect(prepareJob('imports', { tenantId: TENANT, importId: 'imp-9' }).jobId).toBe(
      `import-${TENANT}-imp-9`,
    );
  });

  it('never puts a colon in a job id (BullMQ rejects it)', () => {
    expect(() => prepareJob('sms', { ...sms, messageId: 'a:b' })).toThrow();
  });

  it.each([
    ['unknown field', { ...sms, apiKey: 'x' }],
    ['missing tenant', { ...sms, tenantId: undefined }],
    ['non-uuid tenant', { ...sms, tenantId: 'kamal' }],
    ['landline', { ...sms, to: '+94112345678' }],
    ['unnormalised mobile', { ...sms, to: '0771234567' }],
    ['empty text', { ...sms, text: '' }],
    ['unknown gateway', { ...sms, gateway: 'smtp' }],
  ])('rejects an sms payload with %s', (_label, payload) => {
    expect(() => prepareJob('sms', payload)).toThrow();
  });

  it('keeps sms text out of Valkey as soon as the job completes', () => {
    expect(JOBS.sms.removeOnComplete).toBe(true);
    expect(JOBS.sms.removeOnFail.age).toBeLessThanOrEqual(3600);
  });
});
