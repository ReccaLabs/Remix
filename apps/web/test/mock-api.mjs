// Tiny stand-in for apps/api on :4000 so apps/web can run before the real API lands.
// Dev/test only — never deployed. Run: `pnpm --filter @remix/web mock-api`.
//
// Resolves tenants from X-Forwarded-Host (what both the server-side client and the dev rewrite
// send), with the phase-1 seed slugs. GET /api/v1/_debug/headers echoes the request headers so
// the forwarding behaviour can be inspected.
import { createServer } from 'node:http';

const PORT = Number(process.env.MOCK_API_PORT ?? 4000);

const TENANTS = {
  kamalphysics: {
    name: 'Kamal Physics',
    status: 'active',
    plan: 'institute',
    brandColor: '#0F766E',
  },
  royalscience: { name: 'Royal Science', status: 'trial', plan: 'tutor', brandColor: null },
  closedacademy: {
    name: 'Closed Academy',
    status: 'suspended',
    plan: 'tutor',
    brandColor: '#B42318',
  },
};

function slugOf(req) {
  const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '')
    .toLowerCase()
    .replace(/:\d+$/, '')
    .replace(/\.$/, '');
  const match = /^([a-z0-9-]+)\.localhost$/.exec(host);
  return match && Object.hasOwn(TENANTS, match[1]) ? match[1] : null;
}

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body === undefined ? undefined : JSON.stringify(body));
}

function problem(res, status, code) {
  send(res, status, { type: 'about:blank', title: code, status, code }, 'application/problem+json');
}

createServer((req, res) => {
  const { pathname } = new URL(req.url ?? '/', 'http://mock');
  console.log(req.method, pathname, 'xfh=', req.headers['x-forwarded-host'] ?? '-');

  if (pathname === '/api/v1/_debug/headers') return send(res, 200, req.headers);

  if (req.method === 'GET' && pathname === '/api/v1/tenant') {
    const slug = slugOf(req);
    if (!slug) return problem(res, 404, 'TENANT_NOT_FOUND');
    const t = TENANTS[slug];
    return send(res, 200, {
      id: `0193f1c2-7b1d-7c3e-9a4f-${String(Object.keys(TENANTS).indexOf(slug)).padStart(12, '0')}`,
      slug,
      name: t.name,
      status: t.status,
      plan: t.plan,
      defaultLocale: 'en',
      timezone: 'Asia/Colombo',
      brandColor: t.brandColor,
      logoUrl: null,
    });
  }

  if (req.method === 'GET' && pathname === '/api/v1/auth/session') {
    return problem(res, 401, 'UNAUTHENTICATED');
  }

  return problem(res, 404, 'NOT_FOUND');
}).listen(PORT, () => console.log(`mock API on http://localhost:${PORT}`));
