/** One recorded call to a mock provider. */
export interface RecordedCall<M extends string = string> {
  method: M;
  input: unknown;
}

/**
 * Base for in-memory provider mocks: records every call so tests can assert what would have
 * been sent, and optionally fails the next call to exercise retry/error paths.
 */
export abstract class CallRecorder<M extends string> {
  readonly calls: RecordedCall<M>[] = [];
  private failures: Error[] = [];

  /** Make the next call(s) reject with `error` (queued, one per call). */
  failNext(error: Error = new Error('Provider unavailable')): void {
    this.failures.push(error);
  }

  /** Calls to one method, inputs typed by the caller. */
  callsTo<T>(method: M): T[] {
    return this.calls.filter((c) => c.method === method).map((c) => c.input as T);
  }

  reset(): void {
    this.calls.length = 0;
    this.failures = [];
  }

  /** Record a call; rejects when a failure was queued with {@link failNext}. */
  protected record(method: M, input: unknown): Promise<void> {
    this.calls.push({ method, input: structuredClone(input) });
    const failure = this.failures.shift();
    return failure ? Promise.reject(failure) : Promise.resolve();
  }
}
