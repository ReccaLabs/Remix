-- 0006_people_rls (hand-written) — trigger, row-level security and grants for `guardians`
-- (0005_people). staff_invites got its RLS in 0004_auth_completion_rls. Same pattern as 0002
-- (ADR 0005). Security code: changes need two reviewers.

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.guardians
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
ALTER TABLE public.guardians ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON public.guardians FOR ALL TO remix_app, remix_readonly
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.guardians TO remix_app;
--> statement-breakpoint
GRANT SELECT ON public.guardians TO remix_readonly;
