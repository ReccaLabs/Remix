/**
 * Runs once when the server starts. Validating the environment here makes a misconfigured
 * deploy crash at boot (and fail its health check) instead of serving requests with the wrong
 * host rules or API address.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { getEnv } = await import('./server/env');
    getEnv();
  }
}
