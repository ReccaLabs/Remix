import type request from 'supertest';
import type { SendSmsInput } from '../../../src/integrations/sms/sms.provider';
import { client, cookieValue, PASSWORD, setCookies, type DbTestApp } from './db-app';

export const P = {
  studentLogin: '/api/v1/auth/student/login',
  staffLogin: '/api/v1/auth/staff/login',
  session: '/api/v1/auth/session',
  otpRequest: '/api/v1/auth/otp/request',
  otpVerify: '/api/v1/auth/otp/verify',
  passwordSet: '/api/v1/auth/password/set',
  deviceLimit: '/api/v1/auth/student/device-limit',
  twoStep: '/api/v1/auth/staff/two-step',
  twoStepResend: '/api/v1/auth/staff/two-step/resend',
  invitePreview: '/api/v1/auth/invite/preview',
  inviteAccept: '/api/v1/auth/invite/accept',
  me: '/api/v1/me',
  mePassword: '/api/v1/me/password',
  meDevices: '/api/v1/me/devices',
} as const;

/** `Cookie` header carrying the session and device cookies a response set (dev names). */
export function jar(res: request.Response, previous = ''): string {
  const map = new Map<string, string>();
  for (const part of previous.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) map.set(part.slice(0, i).trim(), part.slice(i + 1).trim());
  }
  for (const [name, line] of setCookies(res)) {
    const value = cookieValue(line);
    if (value === '' || /Max-Age=0/.test(line)) map.delete(name);
    else map.set(name, value);
  }
  return [...map].map(([k, v]) => `${k}=${v}`).join('; ');
}

/** Only the named cookie of a jar, e.g. the device cookie to present on a new login. */
export function only(cookies: string, name: string): string {
  const found = cookies.split('; ').find((c) => c.startsWith(`${name}=`));
  return found ?? '';
}

/** Student login from a "browser" holding `cookies` (e.g. its device cookie). */
export function loginStudent(
  t: DbTestApp,
  host: string,
  phone: string,
  cookies = '',
  password = PASSWORD,
): request.Test {
  return client(t, host).post(P.studentLogin, { phone, password }, cookies || undefined);
}

/** Run the queued SMS jobs and return every message delivered to `phone`, oldest first. */
export async function smsTo(t: DbTestApp, phone: string): Promise<SendSmsInput[]> {
  await t.jobs.drain();
  return t.sms.callsTo<SendSmsInput>('send').filter((m) => m.to === phone);
}

/** The 6-digit code of the latest SMS to `phone`. */
export async function lastCode(t: DbTestApp, phone: string): Promise<string> {
  const messages = await smsTo(t, phone);
  const text = messages.at(-1)?.text ?? '';
  const match = /^(\d{6}) /.exec(text);
  if (!match?.[1]) throw new Error(`no code was sent to ${phone}`);
  return match[1];
}

/** A different 6-digit code than `code`. */
export const wrong = (code: string) => (code === '000000' ? '111111' : '000000');
