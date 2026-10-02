import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigError } from '../config/config';
import { exitOnStartupFailure } from './startup';

describe('exitOnStartupFailure', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const run = (error: unknown) => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    exitOnStartupFailure('API')(error);
    return { exit, output: write.mock.calls.map((c) => String(c[0])).join('') };
  };

  it('prints config problems (names only) and exits 1', () => {
    const { exit, output } = run(new ConfigError(['PORT: Too small']));
    expect(exit).toHaveBeenCalledWith(1);
    expect(output).toContain('PORT: Too small');
  });

  it('prints the stack of other boot failures and exits 1', () => {
    const { exit, output } = run(new Error('listen EADDRINUSE'));
    expect(exit).toHaveBeenCalledWith(1);
    expect(output).toContain('API failed to start');
    expect(output).toContain('EADDRINUSE');
  });
});
