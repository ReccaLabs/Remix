-- 0000_bootstrap (hand-written) — runs as remix_owner before any table exists.
--
-- Roles are cluster-level objects and are NOT created by migrations: dev creates them in
-- infra/docker/postgres/init/01-roles.sql, tests in test/harness.ts, production by the operator
-- (packages/db/README.md → "Production roles"). The database must be owned by remix_owner.
-- Fail fast if that setup is missing or unsafe, instead of half-applying security migrations.
DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(r, ', ') INTO missing
  FROM unnest(ARRAY['remix_owner', 'remix_app', 'remix_platform', 'remix_readonly']) AS r
  WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = r);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'Missing database roles: %. Create them before migrating (packages/db/README.md).', missing;
  END IF;

  IF current_user <> 'remix_owner' THEN
    RAISE EXCEPTION 'Migrations must run as remix_owner (connected as %).', current_user;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname IN ('remix_app', 'remix_platform', 'remix_readonly')
      AND (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb)
  ) THEN
    RAISE EXCEPTION 'remix_app, remix_platform and remix_readonly must be NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB.';
  END IF;

  IF pg_catalog.pg_has_role('remix_app', 'remix_owner', 'MEMBER')
    OR pg_catalog.pg_has_role('remix_platform', 'remix_owner', 'MEMBER')
    OR pg_catalog.pg_has_role('remix_readonly', 'remix_owner', 'MEMBER') THEN
    RAISE EXCEPTION 'Application roles must not be members of remix_owner.';
  END IF;
END
$$;
--> statement-breakpoint

-- Least privilege: nothing for PUBLIC. Each role gets exactly what it needs, below and in 0002.
-- remix_platform gets no access to public at all (ADR 0005): its cross-tenant reads will be views
-- in a separate `platform` schema, owned by remix_owner and granted to it alone.
DO $$
BEGIN
  EXECUTE pg_catalog.format('REVOKE ALL ON DATABASE %I FROM PUBLIC', pg_catalog.current_database());
  EXECUTE pg_catalog.format(
    'GRANT CONNECT ON DATABASE %I TO remix_app, remix_platform, remix_readonly',
    pg_catalog.current_database()
  );
END
$$;
--> statement-breakpoint
REVOKE ALL ON SCHEMA public FROM PUBLIC;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO remix_app, remix_readonly;
--> statement-breakpoint

-- Functions and types created by remix_owner from now on are not usable by PUBLIC by default.
ALTER DEFAULT PRIVILEGES FOR ROLE remix_owner REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE remix_owner REVOKE USAGE ON TYPES FROM PUBLIC;
--> statement-breakpoint

-- The current request's tenant. Unset (or reset to '' at transaction end) → NULL → RLS policies
-- match zero rows. Only withTenant() sets it, with set_config(…, true) inside a transaction.
-- Plain SQL with schema-qualified calls and no SET clause, so the planner can inline it.
CREATE FUNCTION public.app_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT NULLIF(pg_catalog.current_setting('app.tenant_id', true), '')::uuid $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_tenant_id() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.app_tenant_id() TO remix_app, remix_readonly;
--> statement-breakpoint

-- Keeps updated_at honest regardless of what the caller sends. Attached per table in 0002.
CREATE FUNCTION public.set_updated_at() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog
  AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC;
