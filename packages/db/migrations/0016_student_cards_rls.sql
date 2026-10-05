-- STU-06: tenant isolation, immutable identifiers and monotonic card lifecycle.
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
GRANT INSERT (tenant_id, student_id, card_seq, code, kind, formats, nfc_uid, issued_at, issued_by, status, activated_at, activated_by, revoked_at, revoked_by, revoke_reason) ON public.student_cards TO remix_app;
--> statement-breakpoint
GRANT UPDATE (status, nfc_uid, activated_at, activated_by, revoked_at, revoked_by, revoke_reason) ON public.student_cards TO remix_app;
--> statement-breakpoint
REVOKE ALL ON TYPE public.card_format, public.card_kind, public.card_status FROM PUBLIC;
--> statement-breakpoint
GRANT USAGE ON TYPE public.card_format, public.card_kind, public.card_status TO remix_app, remix_readonly;
--> statement-breakpoint
CREATE FUNCTION public.guard_card_lifecycle() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF (OLD.status = 'revoked' AND NEW IS DISTINCT FROM OLD)
     OR (OLD.status = 'active' AND NEW.status = 'ordered')
     OR (OLD.nfc_uid IS NOT NULL AND NEW.nfc_uid IS DISTINCT FROM OLD.nfc_uid)
     OR (OLD.activated_at IS NOT NULL AND (NEW.activated_at IS DISTINCT FROM OLD.activated_at OR NEW.activated_by IS DISTINCT FROM OLD.activated_by)) THEN
    RAISE EXCEPTION 'Card lifecycle cannot be reversed' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.guard_card_lifecycle() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER guard_card_lifecycle BEFORE UPDATE ON public.student_cards FOR EACH ROW EXECUTE FUNCTION public.guard_card_lifecycle();
