import { beforeEach, describe, expect, it, vi } from 'vitest';

const call = vi.hoisted(() => vi.fn());
vi.mock('./api', () => ({ getApi: async () => ({ call }), problemCode: () => undefined }));
vi.mock('./request', () => ({ getRequestContext: async () => ({ requestId: 'test' }) }));
const { loadTeacherOptions } = await import('./classes');

beforeEach(() => {
  call.mockReset();
});
describe('class teacher picker (CLS-02)', () => {
  it('loads unassigned active teachers through the classes permission endpoint', async () => {
    call.mockResolvedValue({ items: [{ id: 'teacher', displayName: 'Unassigned Teacher' }] });
    expect(await loadTeacherOptions()).toEqual([{ id: 'teacher', name: 'Unassigned Teacher' }]);
    expect(call).toHaveBeenCalledExactlyOnceWith('listTeachers');
  });
  it('leaves an empty picker when unavailable', async () => {
    call.mockRejectedValue(new Error('unavailable'));
    expect(await loadTeacherOptions()).toEqual([]);
    expect(call).toHaveBeenCalledExactlyOnceWith('listTeachers');
  });
});
