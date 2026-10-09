-- FEE-05/06 (ADR 0008 §5, ADR 0009): tenant isolation, minimal grants and one-way lifecycles for
-- uploads, bank slips and their invoice-line links. Security review required.
ALTER TABLE public.uploads ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.uploads FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON public.uploads TO remix_app, remix_readonly USING (tenant_id = (SELECT public.app_tenant_id())) WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
--> statement-breakpoint
-- FORCE also binds the owner: seed/migration tools supply a transaction-local tenant.
CREATE POLICY tenant_owner ON public.uploads TO remix_owner USING (tenant_id = (SELECT public.app_tenant_id())) WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
--> statement-breakpoint
REVOKE ALL ON public.uploads FROM remix_app, remix_readonly, remix_platform, PUBLIC;
--> statement-breakpoint
GRANT SELECT ON public.uploads TO remix_app, remix_readonly;
--> statement-breakpoint
GRANT INSERT (tenant_id, kind, created_by, content_type, size_bytes, object_key) ON public.uploads TO remix_app;
--> statement-breakpoint
GRANT UPDATE (status, processed_key, processed_at) ON public.uploads TO remix_app;
--> statement-breakpoint
-- The 24 h clean-up removes unprocessed uploads; the guard below refuses any other delete.
GRANT DELETE ON public.uploads TO remix_app;
--> statement-breakpoint
ALTER TABLE public.bank_slips ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.bank_slips FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON public.bank_slips TO remix_app, remix_readonly USING (tenant_id = (SELECT public.app_tenant_id())) WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
--> statement-breakpoint
CREATE POLICY tenant_owner ON public.bank_slips TO remix_owner USING (tenant_id = (SELECT public.app_tenant_id())) WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
--> statement-breakpoint
REVOKE ALL ON public.bank_slips FROM remix_app, remix_readonly, remix_platform, PUBLIC;
--> statement-breakpoint
GRANT SELECT ON public.bank_slips TO remix_app, remix_readonly;
--> statement-breakpoint
GRANT INSERT (tenant_id, student_id, upload_id, amount_cents, reference, reference_norm, slip_date) ON public.bank_slips TO remix_app;
--> statement-breakpoint
GRANT UPDATE (status, reviewed_by, reviewed_at, reject_reason, payment_id, duplicate_confirmed) ON public.bank_slips TO remix_app;
--> statement-breakpoint
ALTER TABLE public.bank_slip_lines ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.bank_slip_lines FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON public.bank_slip_lines TO remix_app, remix_readonly USING (tenant_id = (SELECT public.app_tenant_id())) WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
--> statement-breakpoint
CREATE POLICY tenant_owner ON public.bank_slip_lines TO remix_owner USING (tenant_id = (SELECT public.app_tenant_id())) WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
--> statement-breakpoint
REVOKE ALL ON public.bank_slip_lines FROM remix_app, remix_readonly, remix_platform, PUBLIC;
--> statement-breakpoint
GRANT SELECT ON public.bank_slip_lines TO remix_app, remix_readonly;
--> statement-breakpoint
GRANT INSERT (tenant_id, slip_id, invoice_line_id) ON public.bank_slip_lines TO remix_app;
--> statement-breakpoint
REVOKE ALL ON TYPE public.upload_status, public.upload_kind, public.slip_status FROM PUBLIC;
--> statement-breakpoint
GRANT USAGE ON TYPE public.upload_status, public.upload_kind, public.slip_status TO remix_app, remix_readonly;
--> statement-breakpoint
-- pending -> processed | rejected, then frozen; only pending rows can be deleted.
CREATE FUNCTION public.guard_upload_lifecycle() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'pending' THEN
      RAISE EXCEPTION 'Only unprocessed uploads can be deleted' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status <> 'pending' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Upload lifecycle cannot be reversed' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.guard_upload_lifecycle() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER guard_upload_lifecycle BEFORE UPDATE OR DELETE ON public.uploads FOR EACH ROW EXECUTE FUNCTION public.guard_upload_lifecycle();
--> statement-breakpoint
-- processing -> submitted | rejected | superseded; submitted -> approved | rejected | superseded;
-- approved, rejected and superseded are final.
CREATE FUNCTION public.guard_slip_lifecycle() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF OLD.status IN ('approved', 'rejected', 'superseded') AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'A reviewed slip cannot change' USING ERRCODE = '23514';
  END IF;
  IF (OLD.status = 'processing' AND NEW.status NOT IN ('processing', 'submitted', 'rejected', 'superseded'))
     OR (OLD.status = 'submitted' AND NEW.status = 'processing') THEN
    RAISE EXCEPTION 'Invalid slip status change' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.guard_slip_lifecycle() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER guard_slip_lifecycle BEFORE UPDATE ON public.bank_slips FOR EACH ROW EXECUTE FUNCTION public.guard_slip_lifecycle();
--> statement-breakpoint
-- Invoker trigger: a slip may only link invoice lines of its own student (cross-row rule). AFTER,
-- so the composite foreign keys (RI_* triggers, which sort first) report cross-tenant ids.
CREATE FUNCTION public.check_slip_line_student() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.bank_slips s
      JOIN public.invoice_lines l ON l.tenant_id = s.tenant_id AND l.id = NEW.invoice_line_id
      JOIN public.invoices i ON i.tenant_id = l.tenant_id AND i.id = l.invoice_id
    WHERE s.tenant_id = NEW.tenant_id AND s.id = NEW.slip_id AND i.student_id = s.student_id
  ) THEN
    RAISE EXCEPTION 'Slip lines must belong to the slip''s student' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.check_slip_line_student() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER slip_line_student AFTER INSERT ON public.bank_slip_lines FOR EACH ROW EXECUTE FUNCTION public.check_slip_line_student();
