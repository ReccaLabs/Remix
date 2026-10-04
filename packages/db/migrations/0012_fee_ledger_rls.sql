-- ADR 0008: append-only money and tenant-bound projections. Security review required.
ALTER TABLE public.tenant_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.tenant_settings FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON public.tenant_settings TO remix_app, remix_readonly USING (tenant_id = (SELECT public.app_tenant_id())) WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
--> statement-breakpoint
-- FORCE also binds the owner: seed/migration tools supply a transaction-local tenant.
CREATE POLICY tenant_owner ON public.tenant_settings TO remix_owner USING (tenant_id = (SELECT public.app_tenant_id())) WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
--> statement-breakpoint
REVOKE ALL ON public.tenant_settings FROM remix_app, remix_readonly, remix_platform, PUBLIC;
--> statement-breakpoint
GRANT SELECT, INSERT ON public.tenant_settings TO remix_app;
--> statement-breakpoint
GRANT SELECT ON public.tenant_settings TO remix_readonly;
--> statement-breakpoint
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.invoices FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON public.invoices TO remix_app, remix_readonly USING (tenant_id = (SELECT public.app_tenant_id())) WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
--> statement-breakpoint
-- FORCE also binds the owner: seed/migration tools supply a transaction-local tenant.
CREATE POLICY tenant_owner ON public.invoices TO remix_owner USING (tenant_id = (SELECT public.app_tenant_id())) WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
--> statement-breakpoint
REVOKE ALL ON public.invoices FROM remix_app, remix_readonly, remix_platform, PUBLIC;
--> statement-breakpoint
GRANT SELECT, INSERT ON public.invoices TO remix_app;
--> statement-breakpoint
GRANT SELECT ON public.invoices TO remix_readonly;
--> statement-breakpoint
ALTER TABLE public.invoice_lines ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.invoice_lines FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON public.invoice_lines TO remix_app, remix_readonly USING (tenant_id = (SELECT public.app_tenant_id())) WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
--> statement-breakpoint
-- FORCE also binds the owner: seed/migration tools supply a transaction-local tenant.
CREATE POLICY tenant_owner ON public.invoice_lines TO remix_owner USING (tenant_id = (SELECT public.app_tenant_id())) WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
--> statement-breakpoint
REVOKE ALL ON public.invoice_lines FROM remix_app, remix_readonly, remix_platform, PUBLIC;
--> statement-breakpoint
GRANT SELECT, INSERT ON public.invoice_lines TO remix_app;
--> statement-breakpoint
GRANT SELECT ON public.invoice_lines TO remix_readonly;
--> statement-breakpoint
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.payments FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON public.payments TO remix_app, remix_readonly USING (tenant_id = (SELECT public.app_tenant_id())) WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
--> statement-breakpoint
-- FORCE also binds the owner: seed/migration tools supply a transaction-local tenant.
CREATE POLICY tenant_owner ON public.payments TO remix_owner USING (tenant_id = (SELECT public.app_tenant_id())) WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
--> statement-breakpoint
REVOKE ALL ON public.payments FROM remix_app, remix_readonly, remix_platform, PUBLIC;
--> statement-breakpoint
GRANT SELECT, INSERT ON public.payments TO remix_app;
--> statement-breakpoint
GRANT SELECT ON public.payments TO remix_readonly;
--> statement-breakpoint
ALTER TABLE public.payment_allocations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.payment_allocations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON public.payment_allocations TO remix_app, remix_readonly USING (tenant_id = (SELECT public.app_tenant_id())) WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
--> statement-breakpoint
-- FORCE also binds the owner: seed/migration tools supply a transaction-local tenant.
CREATE POLICY tenant_owner ON public.payment_allocations TO remix_owner USING (tenant_id = (SELECT public.app_tenant_id())) WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
--> statement-breakpoint
REVOKE ALL ON public.payment_allocations FROM remix_app, remix_readonly, remix_platform, PUBLIC;
--> statement-breakpoint
GRANT SELECT, INSERT ON public.payment_allocations TO remix_app;
--> statement-breakpoint
GRANT SELECT ON public.payment_allocations TO remix_readonly;
--> statement-breakpoint
ALTER TABLE public.receipts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.receipts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON public.receipts TO remix_app, remix_readonly USING (tenant_id = (SELECT public.app_tenant_id())) WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
--> statement-breakpoint
-- FORCE also binds the owner: seed/migration tools supply a transaction-local tenant.
CREATE POLICY tenant_owner ON public.receipts TO remix_owner USING (tenant_id = (SELECT public.app_tenant_id())) WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
--> statement-breakpoint
REVOKE ALL ON public.receipts FROM remix_app, remix_readonly, remix_platform, PUBLIC;
--> statement-breakpoint
GRANT SELECT, INSERT ON public.receipts TO remix_app;
--> statement-breakpoint
GRANT SELECT ON public.receipts TO remix_readonly;
--> statement-breakpoint
GRANT UPDATE (due_day) ON public.tenant_settings TO remix_app;
--> statement-breakpoint
GRANT UPDATE (status, paid_cents) ON public.invoices TO remix_app;
--> statement-breakpoint
GRANT UPDATE (voided_at, void_reason) ON public.invoice_lines TO remix_app;
--> statement-breakpoint
GRANT UPDATE (reversed_at, pdf_key) ON public.receipts TO remix_app;
--> statement-breakpoint
REVOKE ALL ON TYPE public.invoice_status, public.payment_method FROM PUBLIC;
--> statement-breakpoint
GRANT USAGE ON TYPE public.invoice_status, public.payment_method TO remix_app, remix_readonly;
--> statement-breakpoint
-- Invoker trigger: a cross-row sign rule cannot be expressed as a CHECK.
CREATE FUNCTION public.check_allocation_sign() RETURNS trigger
 LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE m public.payment_method;
BEGIN
 SELECT method INTO m FROM public.payments WHERE tenant_id = NEW.tenant_id AND id = NEW.payment_id;
 IF (m = 'reversal' AND NEW.amount_cents >= 0) OR (m <> 'reversal' AND NEW.amount_cents <= 0) THEN
   RAISE EXCEPTION 'Allocation sign must match payment method' USING ERRCODE = '23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.check_allocation_sign() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER allocation_sign BEFORE INSERT ON public.payment_allocations FOR EACH ROW EXECUTE FUNCTION public.check_allocation_sign();
--> statement-breakpoint
CREATE FUNCTION public.check_receipt_payment() RETURNS trigger
 LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
 IF EXISTS (SELECT 1 FROM public.payments WHERE tenant_id = NEW.tenant_id AND id = NEW.payment_id AND method = 'reversal') THEN
   RAISE EXCEPTION 'Reversal payments have no receipt' USING ERRCODE = '23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.check_receipt_payment() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER receipt_payment BEFORE INSERT ON public.receipts FOR EACH ROW EXECUTE FUNCTION public.check_receipt_payment();
--> statement-breakpoint
-- Narrow worker discovery for cron fan-out. Returns identifiers only, never money/user data.
CREATE FUNCTION public.invoice_job_tenants() RETURNS TABLE (id uuid)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
 SELECT t.id FROM public.tenants t WHERE t.status IN ('active', 'trial') ORDER BY t.id
 $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.invoice_job_tenants() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.invoice_job_tenants() TO remix_app;
