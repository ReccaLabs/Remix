-- 0004_auth_completion_rls (hand-written) — row-level security, grants and triggers for the
-- Phase 2 auth tables (AUTH-02/03/05/07/09): otp_challenges, auth_tickets, staff_invites.
-- Security code: changes need two reviewers. Same pattern as 0002 (README → "Adding a table").
--
-- staff_invites belongs to track P2-B (people); it is created here only because the auth flows
-- (AUTH-07 preview/accept) need it. Whichever branch merges second keeps one definition.

-- updated_at triggers ------------------------------------------------------------------------
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.otp_challenges
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.auth_tickets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.staff_invites
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint

-- Row-level security -------------------------------------------------------------------------
ALTER TABLE public.otp_challenges ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.auth_tickets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.staff_invites ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY tenant_isolation ON public.otp_challenges FOR ALL TO remix_app, remix_readonly
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
--> statement-breakpoint
CREATE POLICY tenant_isolation ON public.auth_tickets FOR ALL TO remix_app, remix_readonly
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
--> statement-breakpoint
CREATE POLICY tenant_isolation ON public.staff_invites FOR ALL TO remix_app, remix_readonly
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
--> statement-breakpoint

-- Grants (never TRUNCATE, REFERENCES or TRIGGER) ---------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.otp_challenges, public.auth_tickets, public.staff_invites
  TO remix_app;
--> statement-breakpoint
GRANT SELECT ON public.otp_challenges, public.auth_tickets, public.staff_invites TO remix_readonly;
