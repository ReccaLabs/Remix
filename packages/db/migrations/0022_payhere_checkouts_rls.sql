-- FEE-04 / SET-02 (ADR 0008 §6): tenant isolation, minimal grants and a one-way lifecycle for
-- PayHere checkouts and the invoice lines they pay. Security review required.
ALTER TABLE public.payhere_checkouts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.payhere_checkouts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON public.payhere_checkouts TO remix_app, remix_readonly USING (tenant_id = (SELECT public.app_tenant_id())) WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
--> statement-breakpoint
-- FORCE also binds the owner: seed/migration tools supply a transaction-local tenant.
CREATE POLICY tenant_owner ON public.payhere_checkouts TO remix_owner USING (tenant_id = (SELECT public.app_tenant_id())) WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
--> statement-breakpoint
REVOKE ALL ON public.payhere_checkouts FROM remix_app, remix_readonly, remix_platform, PUBLIC;
--> statement-breakpoint
GRANT SELECT ON public.payhere_checkouts TO remix_app, remix_readonly;
--> statement-breakpoint
GRANT INSERT (tenant_id, kind, student_id, created_by, amount_cents, currency, merchant_id, mode, created_at, expires_at) ON public.payhere_checkouts TO remix_app;
--> statement-breakpoint
GRANT UPDATE (status, status_code, notified_at, provider_payment_id, payment_id, chargeback_at) ON public.payhere_checkouts TO remix_app;
--> statement-breakpoint
ALTER TABLE public.payhere_checkout_lines ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.payhere_checkout_lines FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON public.payhere_checkout_lines TO remix_app, remix_readonly USING (tenant_id = (SELECT public.app_tenant_id())) WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
--> statement-breakpoint
CREATE POLICY tenant_owner ON public.payhere_checkout_lines TO remix_owner USING (tenant_id = (SELECT public.app_tenant_id())) WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
--> statement-breakpoint
REVOKE ALL ON public.payhere_checkout_lines FROM remix_app, remix_readonly, remix_platform, PUBLIC;
--> statement-breakpoint
GRANT SELECT ON public.payhere_checkout_lines TO remix_app, remix_readonly;
--> statement-breakpoint
GRANT INSERT (tenant_id, checkout_id, invoice_line_id) ON public.payhere_checkout_lines TO remix_app;
--> statement-breakpoint
REVOKE ALL ON TYPE public.checkout_status, public.checkout_kind FROM PUBLIC;
--> statement-breakpoint
GRANT USAGE ON TYPE public.checkout_status, public.checkout_kind TO remix_app, remix_readonly;
--> statement-breakpoint
-- pending -> any other status; failed | cancelled | expired -> each other or paid (a late success
-- still took the money); paid is final. Once set, the PayHere payment id, the ledger payment and
-- the chargeback flag never change.
CREATE FUNCTION public.guard_checkout_lifecycle() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF OLD.status = 'paid' AND NEW.status <> 'paid' THEN
    RAISE EXCEPTION 'A paid checkout cannot change status' USING ERRCODE = '23514';
  END IF;
  IF OLD.status <> 'pending' AND NEW.status = 'pending' THEN
    RAISE EXCEPTION 'Invalid checkout status change' USING ERRCODE = '23514';
  END IF;
  IF (OLD.provider_payment_id IS NOT NULL AND NEW.provider_payment_id IS DISTINCT FROM OLD.provider_payment_id)
     OR (OLD.payment_id IS NOT NULL AND NEW.payment_id IS DISTINCT FROM OLD.payment_id)
     OR (OLD.chargeback_at IS NOT NULL AND NEW.chargeback_at IS DISTINCT FROM OLD.chargeback_at) THEN
    RAISE EXCEPTION 'Checkout payment details cannot change' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.guard_checkout_lifecycle() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER guard_checkout_lifecycle BEFORE UPDATE ON public.payhere_checkouts FOR EACH ROW EXECUTE FUNCTION public.guard_checkout_lifecycle();
--> statement-breakpoint
-- Invoker trigger: a checkout may only link invoice lines of its own student, and only a fees
-- checkout has lines. AFTER, so the composite foreign keys report cross-tenant ids first.
CREATE FUNCTION public.check_checkout_line_student() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.payhere_checkouts c
      JOIN public.invoice_lines l ON l.tenant_id = c.tenant_id AND l.id = NEW.invoice_line_id
      JOIN public.invoices i ON i.tenant_id = l.tenant_id AND i.id = l.invoice_id
    WHERE c.tenant_id = NEW.tenant_id AND c.id = NEW.checkout_id AND c.kind = 'fees' AND i.student_id = c.student_id
  ) THEN
    RAISE EXCEPTION 'Checkout lines must belong to the checkout''s student' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.check_checkout_line_student() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER checkout_line_student AFTER INSERT ON public.payhere_checkout_lines FOR EACH ROW EXECUTE FUNCTION public.check_checkout_line_student();
