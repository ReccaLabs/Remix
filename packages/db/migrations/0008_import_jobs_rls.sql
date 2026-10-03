-- 0008_import_jobs_rls (hand-written) — trigger, row-level security and grants for `import_jobs`
-- (0007_import_jobs, STU-04). Same pattern as 0002/0006 (ADR 0005). Security code: changes need
-- two reviewers.

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.import_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
ALTER TABLE public.import_jobs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON public.import_jobs FOR ALL TO remix_app, remix_readonly
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.import_jobs TO remix_app;
--> statement-breakpoint
GRANT SELECT ON public.import_jobs TO remix_readonly;
