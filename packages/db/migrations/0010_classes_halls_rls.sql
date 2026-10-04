-- 0010_classes_halls_rls (hand-written) — row-level security and grants for `halls`
-- (0009_classes_halls), settings writes on the tenant row, and the resolver with `favicon_url`
-- (TEN-03). Same pattern as 0002 (ADR 0005). Security code: changes need two reviewers.

-- halls: tenant isolation ------------------------------------------------------------------
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.halls
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
ALTER TABLE public.halls ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON public.halls FOR ALL TO remix_app, remix_readonly
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.halls TO remix_app;
--> statement-breakpoint
GRANT SELECT ON public.halls TO remix_readonly;
--> statement-breakpoint

-- Settings → General and Theme (TEN-03): the app may change exactly these five columns of its
-- OWN tenant row (policy: id = app_tenant_id()). Plan, status, slug and student-number prefix
-- stay platform-only. Column-level grant: any other column is "permission denied".
CREATE POLICY tenant_update_own ON public.tenants FOR UPDATE TO remix_app
  USING (id = (SELECT public.app_tenant_id()))
  WITH CHECK (id = (SELECT public.app_tenant_id()));
--> statement-breakpoint
GRANT UPDATE (name, default_locale, brand_color, logo_url, favicon_url) ON public.tenants TO remix_app;
--> statement-breakpoint

-- Tenant resolver gains `favicon_url`. The return type changes, so the functions are replaced.
DROP FUNCTION public.resolve_tenant_by_slug(text);
--> statement-breakpoint
DROP FUNCTION public.resolve_tenant_by_domain(text);
--> statement-breakpoint
CREATE FUNCTION public.resolve_tenant_by_slug(p_slug text)
  RETURNS TABLE (
    id uuid, slug text, name text, status text, plan text, default_locale text, timezone text,
    brand_color text, logo_url text, favicon_url text
  )
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
    SELECT t.id, t.slug, t.name, t.status::text, t.plan::text, t.default_locale::text,
           t.timezone, t.brand_color, t.logo_url, t.favicon_url
    FROM public.tenants AS t
    WHERE t.slug = p_slug
  $$;
--> statement-breakpoint
CREATE FUNCTION public.resolve_tenant_by_domain(p_host text)
  RETURNS TABLE (
    id uuid, slug text, name text, status text, plan text, default_locale text, timezone text,
    brand_color text, logo_url text, favicon_url text
  )
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
    SELECT t.id, t.slug, t.name, t.status::text, t.plan::text, t.default_locale::text,
           t.timezone, t.brand_color, t.logo_url, t.favicon_url
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
