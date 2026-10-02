-- 0002_rls_grants_resolvers (hand-written) — row-level security, grants and tenant resolution
-- for the Phase 1 tables (ADR 0005). Security code: changes need two reviewers.
--
-- Every table is ENABLE ROW LEVEL SECURITY (not FORCE): the owner bypasses RLS for migrations,
-- seed and provisioning CLIs, and its credential never reaches a running app. Policies apply to
-- remix_app (the API) and remix_readonly (single-tenant support queries); remix_platform has no
-- access to these tables. `(SELECT app_tenant_id())` is evaluated once per statement (init plan)
-- and can drive an index scan on the leading tenant_id column.
--
-- The isolation suite (test/) fails when a table in `public` lacks RLS, a policy, its grants
-- matrix entry or its factory. When adding a table, follow README.md → "Adding a table".

-- updated_at triggers ------------------------------------------------------------------------
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.tenant_domains
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.tenant_users
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.staff_roles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.devices
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.classes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.class_schedules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.enrollments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.tenant_counters
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint

-- Row-level security -------------------------------------------------------------------------
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.tenant_domains ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.tenant_users ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.staff_roles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.classes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.class_schedules ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.enrollments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.tenant_counters ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- tenants: the tenant root has no tenant_id; a tenant context may read only its own row.
CREATE POLICY tenant_isolation ON public.tenants FOR SELECT TO remix_app, remix_readonly
  USING (id = (SELECT public.app_tenant_id()));
--> statement-breakpoint

-- tenant_domains: read-only for the app (domains are managed by the platform, Phase 2).
CREATE POLICY tenant_isolation ON public.tenant_domains FOR SELECT TO remix_app, remix_readonly
  USING (tenant_id = (SELECT public.app_tenant_id()));
--> statement-breakpoint

-- Ordinary tenant tables: full DML inside the tenant, nothing outside it.
CREATE POLICY tenant_isolation ON public.tenant_users FOR ALL TO remix_app, remix_readonly
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
--> statement-breakpoint
CREATE POLICY tenant_isolation ON public.staff_roles FOR ALL TO remix_app, remix_readonly
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
--> statement-breakpoint
CREATE POLICY tenant_isolation ON public.students FOR ALL TO remix_app, remix_readonly
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
--> statement-breakpoint
CREATE POLICY tenant_isolation ON public.devices FOR ALL TO remix_app, remix_readonly
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
--> statement-breakpoint
CREATE POLICY tenant_isolation ON public.sessions FOR ALL TO remix_app, remix_readonly
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
--> statement-breakpoint
CREATE POLICY tenant_isolation ON public.classes FOR ALL TO remix_app, remix_readonly
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
--> statement-breakpoint
CREATE POLICY tenant_isolation ON public.class_schedules FOR ALL TO remix_app, remix_readonly
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
--> statement-breakpoint
CREATE POLICY tenant_isolation ON public.enrollments FOR ALL TO remix_app, remix_readonly
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
--> statement-breakpoint
CREATE POLICY tenant_isolation ON public.tenant_counters FOR ALL TO remix_app, remix_readonly
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
--> statement-breakpoint

-- audit_logs: append-only. Separate SELECT and INSERT policies; no UPDATE/DELETE grant exists.
CREATE POLICY tenant_isolation ON public.audit_logs FOR SELECT TO remix_app, remix_readonly
  USING (tenant_id = (SELECT public.app_tenant_id()));
--> statement-breakpoint
CREATE POLICY tenant_isolation_insert ON public.audit_logs FOR INSERT TO remix_app
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
--> statement-breakpoint

-- Grants (table level; never TRUNCATE, REFERENCES or TRIGGER — TRUNCATE ignores RLS) ----------
GRANT SELECT ON public.tenants, public.tenant_domains TO remix_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.tenant_users, public.staff_roles, public.students, public.devices, public.sessions,
  public.classes, public.class_schedules, public.enrollments, public.tenant_counters
  TO remix_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON public.audit_logs TO remix_app;
--> statement-breakpoint
GRANT SELECT ON
  public.tenants, public.tenant_domains, public.tenant_users, public.staff_roles, public.students,
  public.devices, public.sessions, public.classes, public.class_schedules, public.enrollments,
  public.tenant_counters, public.audit_logs
  TO remix_readonly;
--> statement-breakpoint

-- Host → tenant resolution (TEN-01) ----------------------------------------------------------
-- The app resolves the tenant before it has a tenant context, so it cannot read `tenants`
-- directly. These SECURITY DEFINER functions run as remix_owner and return exactly the fields
-- of tenantPublicSchema (@remix/types) for one slug or one *verified* custom host.
CREATE FUNCTION public.resolve_tenant_by_slug(p_slug text)
  RETURNS TABLE (
    id uuid, slug text, name text, status text, plan text, default_locale text, timezone text,
    brand_color text, logo_url text
  )
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
    SELECT t.id, t.slug, t.name, t.status::text, t.plan::text, t.default_locale::text,
           t.timezone, t.brand_color, t.logo_url
    FROM public.tenants AS t
    WHERE t.slug = p_slug
  $$;
--> statement-breakpoint
CREATE FUNCTION public.resolve_tenant_by_domain(p_host text)
  RETURNS TABLE (
    id uuid, slug text, name text, status text, plan text, default_locale text, timezone text,
    brand_color text, logo_url text
  )
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
    SELECT t.id, t.slug, t.name, t.status::text, t.plan::text, t.default_locale::text,
           t.timezone, t.brand_color, t.logo_url
    FROM public.tenant_domains AS d
    JOIN public.tenants AS t ON t.id = d.tenant_id
    WHERE d.host = p_host AND d.verified_at IS NOT NULL
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.resolve_tenant_by_slug(text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.resolve_tenant_by_domain(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.resolve_tenant_by_slug(text) TO remix_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.resolve_tenant_by_domain(text) TO remix_app;
