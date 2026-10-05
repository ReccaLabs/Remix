-- Custom SQL migration file, put your code below! --
-- SET-02/03: tenant-bound secrets and narrow mutable settings grants.
ALTER TABLE public.tenant_integrations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.tenant_integrations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON public.tenant_integrations TO remix_app, remix_readonly USING (tenant_id = (SELECT public.app_tenant_id())) WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
--> statement-breakpoint
CREATE POLICY tenant_owner ON public.tenant_integrations TO remix_owner USING (tenant_id = (SELECT public.app_tenant_id())) WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
--> statement-breakpoint
REVOKE ALL ON public.tenant_integrations FROM remix_app, remix_readonly, remix_platform, PUBLIC;
--> statement-breakpoint
GRANT SELECT ON public.tenant_integrations TO remix_app;
--> statement-breakpoint
GRANT SELECT (id, tenant_id, kind, config) ON public.tenant_integrations TO remix_readonly;
--> statement-breakpoint
GRANT INSERT (tenant_id, kind, config, secret_ciphertext, secret_nonce, key_id) ON public.tenant_integrations TO remix_app;
--> statement-breakpoint
GRANT UPDATE (config, secret_ciphertext, secret_nonce, key_id) ON public.tenant_integrations TO remix_app;
--> statement-breakpoint
GRANT UPDATE (reminders_enabled, remind_before_days, remind_after_days, bank_details, receipt_address, receipt_phone, receipt_footer) ON public.tenant_settings TO remix_app;
--> statement-breakpoint
REVOKE ALL ON TYPE public.integration_kind FROM PUBLIC;
--> statement-breakpoint
GRANT USAGE ON TYPE public.integration_kind TO remix_app, remix_readonly;
