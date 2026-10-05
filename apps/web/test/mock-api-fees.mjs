// DEV/TEST ONLY. Settings and receipts mock; no credentials are persisted in this module.
import { randomUUID } from 'node:crypto';
import { settingsFor } from './mock-api-classes.mjs';

const stores = new Map();
const RECEIPT_ID = '0193f1c2-7b1d-7c3e-9a4f-000000000900';
function storeFor(tenant) {
  if (!stores.has(tenant.slug))
    stores.set(tenant.slug, {
      payhere: {
        enabled: false,
        mode: 'sandbox',
        merchantId: null,
        secretHint: null,
        lastTest: null,
      },
      fees: {
        dueDay: 5,
        remindersEnabled: false,
        remindBeforeDays: 0,
        remindAfterDays: 1,
        bankDetails: null,
        receipt: { address: null, phone: null, footer: null },
      },
    });
  return stores.get(tenant.slug);
}
const only = (body, fields) =>
  body &&
  typeof body === 'object' &&
  !Array.isArray(body) &&
  Object.keys(body).every((k) => fields.includes(k));
const bounded = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;
const nullableText = (value, max) =>
  value === null || (typeof value === 'string' && value.trim().length <= max);

export async function handleFees(env) {
  const {
    req,
    res,
    pathname,
    tenantOf,
    currentSession,
    USERS,
    json,
    problem,
    readJson,
    csrfRejected,
  } = env;
  const payhere = pathname === '/api/v1/admin/settings/payhere';
  const test = pathname === '/api/v1/admin/settings/payhere/test';
  const fees = pathname === '/api/v1/admin/settings/fees';
  const receipt = /^\/api\/v1\/admin\/receipts\/([^/]+)$/.exec(pathname);
  const pdf = /^\/api\/v1\/receipts\/([^/]+)\/pdf$/.exec(pathname);
  if (!payhere && !test && !fees && !receipt && !pdf) return false;
  const tenant = tenantOf(req);
  if (!tenant) return (problem(res, 404, 'TENANT_NOT_FOUND'), true);
  const current = currentSession(req, tenant);
  if (!current) return (problem(res, 401, 'UNAUTHENTICATED'), true);
  const user = USERS.find((u) => u.id === current.session.userId);
  const owner = user?.kind === 'staff' && user.roles.includes('owner');
  const reader =
    user?.kind === 'staff' && user.roles.some((r) => ['owner', 'admin', 'cashier'].includes(r));
  if ((payhere || test || fees) && !owner) return (problem(res, 403, 'FORBIDDEN'), true);
  if (tenant.status === 'suspended' || tenant.status === 'cancelled')
    return (problem(res, 403, 'TENANT_UNAVAILABLE'), true);
  const store = storeFor(tenant);
  res.setHeader('cache-control', 'no-store');
  if (receipt || pdf) {
    if (req.method !== 'GET') return (problem(res, 405, 'METHOD_NOT_ALLOWED'), true);
    if (!reader && !(pdf && user.kind === 'student')) return (problem(res, 403, 'FORBIDDEN'), true);
    const student = USERS.find((u) => u.tenant === tenant.slug && u.kind === 'student');
    if ((receipt ?? pdf)[1] !== RECEIPT_ID || (user.kind === 'student' && user.id !== student?.id))
      return (problem(res, 404, 'NOT_FOUND'), true);
    if (pdf) {
      json(res, 200, {
        url: `https://storage.mock.invalid/${tenant.id}/receipts/2026/10/${RECEIPT_ID}.pdf?sig=mock`,
        expiresAt: new Date(Date.now() + 600000).toISOString(),
      });
      return true;
    }
    const theme = settingsFor(tenant);
    json(res, 200, {
      id: RECEIPT_ID,
      number: 'SAMPLE-R-26-00001',
      paymentId: '0193f1c2-7b1d-7c3e-9a4f-000000000901',
      issuedAt: '2026-10-15T04:30:00Z',
      method: 'cash',
      amountCents: 250000,
      cashReceivedCents: 300000,
      changeCents: 50000,
      studentNo: 'SAMPLE-00001',
      studentName: student?.displayName ?? 'Sample Student',
      lines: [{ className: 'Sample Physics', month: '2026-10-01', amountCents: 250000 }],
      reversedAt: null,
      institute: { name: theme.name, logoUrl: theme.logoUrl, ...store.fees.receipt },
    });
    return true;
  }
  if (req.method === 'GET' && !test) {
    json(res, 200, payhere ? store.payhere : store.fees);
    return true;
  }
  if ((test && req.method !== 'POST') || (!test && req.method !== 'PATCH'))
    return (problem(res, 405, 'METHOD_NOT_ALLOWED'), true);
  if (csrfRejected(req, res)) return true;
  const body = await readJson(req);
  const invalid = () => (problem(res, 400, 'VALIDATION_FAILED'), true);
  if (test) {
    if (!store.payhere.merchantId || !store.payhere.secretHint) return invalid();
    const checkoutId = randomUUID();
    const origin = `${req.headers['x-forwarded-proto'] ?? 'http'}://${req.headers['x-forwarded-host'] ?? req.headers.host}`;
    store.payhere.lastTest = { at: new Date().toISOString(), status: 'pending' };
    json(res, 200, {
      checkoutId,
      actionUrl:
        store.payhere.mode === 'sandbox'
          ? 'https://sandbox.payhere.lk/pay/checkout'
          : 'https://www.payhere.lk/pay/checkout',
      fields: {
        merchant_id: store.payhere.merchantId,
        order_id: checkoutId,
        amount: '10.00',
        currency: 'LKR',
        hash: '0'.repeat(32),
        items: 'Sample integration test',
        return_url: `${origin}/admin/settings/payments`,
        cancel_url: `${origin}/admin/settings/payments`,
        notify_url: `${origin}/api/v1/webhooks/payhere/${tenant.slug}`,
      },
    });
    return true;
  }
  if (payhere) {
    if (!only(body, ['enabled', 'mode', 'merchantId', 'merchantSecret'])) return invalid();
    if (body.enabled !== undefined && typeof body.enabled !== 'boolean') return invalid();
    if (body.mode !== undefined && !['sandbox', 'live'].includes(body.mode)) return invalid();
    if (
      body.merchantId !== undefined &&
      (typeof body.merchantId !== 'string' || !/^\d{4,20}$/.test(body.merchantId.trim()))
    )
      return invalid();
    if (
      body.merchantSecret !== undefined &&
      (typeof body.merchantSecret !== 'string' ||
        body.merchantSecret.trim().length < 8 ||
        body.merchantSecret.trim().length > 200)
    )
      return invalid();
    const next = { ...store.payhere };
    for (const key of ['enabled', 'mode', 'merchantId'])
      if (body[key] !== undefined)
        next[key] = typeof body[key] === 'string' ? body[key].trim() : body[key];
    if (body.merchantSecret !== undefined)
      next.secretHint = `••••${body.merchantSecret.trim().slice(-4)}`;
    if (next.enabled && (!next.merchantId || !next.secretHint)) return invalid();
    store.payhere = next;
    json(res, 200, next);
    return true;
  }
  if (
    !only(body, [
      'dueDay',
      'remindersEnabled',
      'remindBeforeDays',
      'remindAfterDays',
      'bankDetails',
      'receipt',
    ]) ||
    !Object.keys(body).length
  )
    return invalid();
  for (const [key, min, max] of [
    ['dueDay', 1, 28],
    ['remindBeforeDays', 0, 10],
    ['remindAfterDays', 1, 30],
  ])
    if (body[key] !== undefined && !bounded(body[key], min, max)) return invalid();
  if (body.remindersEnabled !== undefined && typeof body.remindersEnabled !== 'boolean')
    return invalid();
  if (
    body.receipt !== undefined &&
    (!only(body.receipt, ['address', 'phone', 'footer']) ||
      Object.entries(body.receipt).some(
        ([key, value]) => !nullableText(value, key === 'phone' ? 40 : 200),
      ))
  )
    return invalid();
  const bank = body.bankDetails;
  if (bank !== undefined && bank !== null) {
    if (
      !only(bank, ['bankName', 'branch', 'accountNumber', 'accountName']) ||
      Object.keys(bank).length !== 4
    )
      return invalid();
    for (const [key, max] of [
      ['bankName', 80],
      ['branch', 80],
      ['accountName', 120],
    ])
      if (
        typeof bank[key] !== 'string' ||
        bank[key].trim().length < 2 ||
        bank[key].trim().length > max
      )
        return invalid();
    if (
      typeof bank.accountNumber !== 'string' ||
      !/^[0-9 -]{6,24}$/.test(bank.accountNumber.trim())
    )
      return invalid();
  }
  store.fees = { ...store.fees, ...body, receipt: { ...store.fees.receipt, ...body.receipt } };
  json(res, 200, store.fees);
  return true;
}
