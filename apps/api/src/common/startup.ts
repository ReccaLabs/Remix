import { ConfigError } from '../config/config';

/**
 * Last-resort handler for a failed boot. The logger may not exist yet (invalid config), so this
 * writes plain lines to stderr and exits non-zero, which the process manager reports.
 */
export function exitOnStartupFailure(what: string): (error: unknown) => never {
  return (error) => {
    if (error instanceof ConfigError) {
      process.stderr.write(`${error.message}\n`);
    } else {
      process.stderr.write(`${what} failed to start\n`);
      process.stderr.write(
        `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
      );
    }
    process.exit(1);
  };
}
