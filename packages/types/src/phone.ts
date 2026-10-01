import { z } from 'zod';

/**
 * Sri Lankan mobile: accepts 07X…, 7X…, +947X…, 947X…, 00947X… with spaces, dashes, dots or
 * brackets; normalises to +947XXXXXXXX. Landlines (0XX with a non-7 area code) are rejected.
 */
export const sriLankaMobile = z
  .string()
  .trim()
  .max(24)
  .transform((v) => v.replace(/[\s\-().]/g, ''))
  .pipe(
    z
      .string()
      .regex(/^(?:\+94|0094|94|0)?7\d{8}$/, 'Enter a Sri Lankan mobile number, e.g. 077 123 4567')
      .transform((v) => `+94${v.slice(-9)}`),
  );
