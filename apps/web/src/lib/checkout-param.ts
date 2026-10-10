import { z } from 'zod';

/** `?checkout=<uuid>` from our own PayHere return/cancel URL; anything else is ignored (FEE-04). */
export function checkoutParam(value: string | string[] | undefined): string | null {
  const parsed = z.uuid().safeParse(value);
  return parsed.success ? parsed.data : null;
}
