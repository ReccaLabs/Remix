/**
 * AUTH-09 / DEVELOPMENT.md §5.1 "block common passwords": the most common leaked passwords of 8+
 * characters (the policy minimum), plus a few local ones. A small, fixed list on purpose — it
 * stops the guesses an attacker tries first without a network call or a large dependency; a
 * breached-password (k-anonymity) check can replace it later.
 */
const COMMON = new Set([
  '12345678',
  '123456789',
  '1234567890',
  '0123456789',
  '11111111',
  '00000000',
  '12341234',
  '87654321',
  '11223344',
  '12121212',
  '123123123',
  '1q2w3e4r',
  '1qaz2wsx',
  'qwertyui',
  'qwertyuiop',
  'asdfghjk',
  'zxcvbnm1',
  'password',
  'password1',
  'password12',
  'password123',
  'passw0rd',
  'p@ssw0rd',
  'p@ssword',
  'iloveyou',
  'sunshine',
  'princess',
  'football',
  'baseball',
  'welcome1',
  'welcome123',
  'abc12345',
  'abcd1234',
  'aa123456',
  'qwerty123',
  'qwerty12',
  'letmein1',
  'trustno1',
  'superman',
  'starwars',
  'whatever',
  'computer',
  'michelle',
  'jennifer',
  'admin123',
  'administrator',
  'changeme',
  'master123',
  'monkey123',
  'dragon123',
  'loveyou1',
  'srilanka',
  'srilanka1',
  'srilanka123',
  'colombo1',
  'colombo123',
  'remix123',
  'student1',
  'student123',
  'teacher1',
  'teacher123',
  'physics1',
  'physics123',
]);

/** True for a password on the common list or made of one repeated character. */
export function isCommonPassword(password: string): boolean {
  const normalised = password.trim().toLowerCase();
  if (COMMON.has(normalised)) return true;
  return normalised.length > 0 && /^(.)\1*$/u.test(normalised);
}
