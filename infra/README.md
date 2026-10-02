# infra

```
infra/
├── docker/     compose.yaml for local dev: Postgres 18, Valkey, Mailpit, SeaweedFS (S3 API, R2 stand-in);
│               postgres/init creates the four database roles (dev passwords only)
└── deploy/     (Phase 1, pending) Kamal config, server bootstrap (non-root user, SSH keys only,
                unattended-upgrades), Hetzner firewall (443 from Cloudflare ranges only), backup scripts
```

Local stack: `docker compose -f infra/docker/compose.yaml up -d`, then `pnpm --filter @remix/db migrate` and `seed`. Every port binds to `127.0.0.1`. Row-level security, grants and resolver functions live in the migrations (`packages/db/migrations`), not in the init script; see [packages/db/README.md](../packages/db/README.md) and [ADR 0005](../docs/decisions/0005-tenancy-shared-schema-rls.md).

remix.lk needs nothing here: it deploys to Cloudflare Pages (`apps/site`, build `pnpm --filter @remix/site build`, output `apps/site/out`). Secrets are set in Cloudflare/Kamal, never committed.
