-- Custom SQL migration file, put your code below! --
ALTER TABLE public.student_cards ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.student_cards FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON public.student_cards TO remix_app, remix_readonly USING (tenant_id = (SELECT public.app_tenant_id())) WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
--> statement-breakpoint
CREATE POLICY tenant_owner ON public.student_cards TO remix_owner USING (tenant_id = (SELECT public.app_tenant_id())) WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
--> statement-breakpoint
REVOKE ALL ON public.student_cards FROM remix_app, remix_readonly, remix_platform, PUBLIC;
--> statement-breakpoint
GRANT SELECT ON public.student_cards TO remix_app, remix_readonly;
--> statement-breakpoint
GRANT INSERT (tenant_id, student_id, code, format, source, issued_at, issued_by, status, revoked_at, revoked_by, revoke_reason) ON public.student_cards TO remix_app;
--> statement-breakpoint
GRANT UPDATE (status, revoked_at, revoked_by, revoke_reason) ON public.student_cards TO remix_app;
--> statement-breakpoint
REVOKE ALL ON TYPE public.card_format, public.card_source, public.card_status FROM PUBLIC;
--> statement-breakpoint
GRANT USAGE ON TYPE public.card_format, public.card_source, public.card_status TO remix_app, remix_readonly;
