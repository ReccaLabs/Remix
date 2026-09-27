# infra (Phase 1)

```
infra/
├── docker/     compose.yaml for local dev (Postgres 18, Valkey, Mailpit), postgres init (roles, RLS)
└── deploy/     Kamal config, server bootstrap (non-root user, SSH keys only, unattended-upgrades),
                Hetzner firewall (443 from Cloudflare ranges only), backup scripts
```

remix.lk needs nothing here: it deploys to Cloudflare Pages (`apps/site`, build `pnpm --filter @remix/site build`, output `apps/site/out`). Secrets are set in Cloudflare/Kamal, never committed.
