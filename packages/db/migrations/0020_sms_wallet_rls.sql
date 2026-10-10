-- MSG-02: tenant isolation and the SMS wallet money rules. Security review required.
-- The balance is a projection of an append-only ledger: only the ledger trigger may change it, it can
-- never go below zero (row lock + check), and the app role can insert `send`/`refund` entries only.
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.sms_wallets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.sms_messages
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
-- sms_wallets ------------------------------------------------------------------------------------
ALTER TABLE public.sms_wallets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.sms_wallets FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON public.sms_wallets TO remix_app, remix_readonly USING (tenant_id = (SELECT public.app_tenant_id())) WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
--> statement-breakpoint
-- FORCE also binds the owner: staff tooling supplies a transaction-local tenant.
CREATE POLICY tenant_owner ON public.sms_wallets TO remix_owner USING (tenant_id = (SELECT public.app_tenant_id())) WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
--> statement-breakpoint
REVOKE ALL ON public.sms_wallets FROM remix_app, remix_readonly, remix_platform, PUBLIC;
--> statement-breakpoint
GRANT SELECT ON public.sms_wallets TO remix_app, remix_readonly;
--> statement-breakpoint
GRANT INSERT (tenant_id) ON public.sms_wallets TO remix_app;
--> statement-breakpoint
GRANT UPDATE (balance_cents, low_balance_alerted_at) ON public.sms_wallets TO remix_app;
--> statement-breakpoint
-- Direct balance edits are refused; the ledger trigger updates it one trigger level deeper.
CREATE FUNCTION public.guard_sms_wallet_balance() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.balance_cents IS DISTINCT FROM OLD.balance_cents AND pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'The SMS wallet balance changes only through the ledger' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.guard_sms_wallet_balance() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER guard_sms_wallet_balance BEFORE UPDATE ON public.sms_wallets FOR EACH ROW EXECUTE FUNCTION public.guard_sms_wallet_balance();
--> statement-breakpoint
-- sms_messages -----------------------------------------------------------------------------------
ALTER TABLE public.sms_messages ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.sms_messages FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON public.sms_messages TO remix_app, remix_readonly USING (tenant_id = (SELECT public.app_tenant_id())) WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
--> statement-breakpoint
CREATE POLICY tenant_owner ON public.sms_messages TO remix_owner USING (tenant_id = (SELECT public.app_tenant_id())) WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
--> statement-breakpoint
REVOKE ALL ON public.sms_messages FROM remix_app, remix_readonly, remix_platform, PUBLIC;
--> statement-breakpoint
GRANT SELECT ON public.sms_messages TO remix_app, remix_readonly;
--> statement-breakpoint
GRANT INSERT (tenant_id, message_id, template, segments, cost_cents) ON public.sms_messages TO remix_app;
--> statement-breakpoint
GRANT UPDATE (status) ON public.sms_messages TO remix_app;
--> statement-breakpoint
-- pending -> queued -> sent | failed; never backwards, never out of a terminal state.
CREATE FUNCTION public.guard_sms_message_status() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE old_rank int; new_rank int;
BEGIN
  old_rank := CASE OLD.status WHEN 'pending' THEN 0 WHEN 'queued' THEN 1 ELSE 2 END;
  new_rank := CASE NEW.status WHEN 'pending' THEN 0 WHEN 'queued' THEN 1 ELSE 2 END;
  IF NEW.status IS DISTINCT FROM OLD.status AND (new_rank <= old_rank) THEN
    RAISE EXCEPTION 'SMS message status cannot go from % to %', OLD.status, NEW.status USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.guard_sms_message_status() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER guard_sms_message_status BEFORE UPDATE ON public.sms_messages FOR EACH ROW EXECUTE FUNCTION public.guard_sms_message_status();
--> statement-breakpoint
-- sms_wallet_ledger (append-only) --------------------------------------------------------------------
ALTER TABLE public.sms_wallet_ledger ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.sms_wallet_ledger FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON public.sms_wallet_ledger FOR SELECT TO remix_app, remix_readonly USING (tenant_id = (SELECT public.app_tenant_id()));
--> statement-breakpoint
-- The app role can only spend and give back; credits (top_up, adjustment) come from staff tooling.
CREATE POLICY app_spend ON public.sms_wallet_ledger FOR INSERT TO remix_app WITH CHECK (tenant_id = (SELECT public.app_tenant_id()) AND kind IN ('send', 'refund'));
--> statement-breakpoint
CREATE POLICY tenant_owner ON public.sms_wallet_ledger TO remix_owner USING (tenant_id = (SELECT public.app_tenant_id())) WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
--> statement-breakpoint
REVOKE ALL ON public.sms_wallet_ledger FROM remix_app, remix_readonly, remix_platform, PUBLIC;
--> statement-breakpoint
GRANT SELECT ON public.sms_wallet_ledger TO remix_app, remix_readonly;
--> statement-breakpoint
-- balance_after_cents is not insertable: the trigger computes it.
GRANT INSERT (tenant_id, kind, amount_cents, message_id, segments, note, actor_id, created_at) ON public.sms_wallet_ledger TO remix_app;
--> statement-breakpoint
CREATE FUNCTION public.apply_sms_ledger_entry() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE bal bigint; threshold bigint; spent bigint;
BEGIN
  INSERT INTO public.sms_wallets (tenant_id) VALUES (NEW.tenant_id) ON CONFLICT (tenant_id) DO NOTHING;
  -- The row lock serialises every entry of this tenant: concurrent debits queue up here and each
  -- sees the balance left by the previous one.
  SELECT balance_cents, low_balance_threshold_cents INTO bal, threshold FROM public.sms_wallets WHERE tenant_id = NEW.tenant_id FOR UPDATE;
  IF NEW.kind = 'refund' THEN
    SELECT -amount_cents INTO spent FROM public.sms_wallet_ledger WHERE tenant_id = NEW.tenant_id AND message_id = NEW.message_id AND kind = 'send';
    IF spent IS NULL OR spent <> NEW.amount_cents THEN
      RAISE EXCEPTION 'A refund must match the debit of the same message' USING ERRCODE = '23514';
    END IF;
  END IF;
  NEW.balance_after_cents := bal + NEW.amount_cents;
  IF NEW.balance_after_cents < 0 THEN
    RAISE EXCEPTION 'INSUFFICIENT_SMS_BALANCE' USING ERRCODE = '23514';
  END IF;
  UPDATE public.sms_wallets SET balance_cents = NEW.balance_after_cents,
    low_balance_alerted_at = CASE WHEN NEW.amount_cents > 0 AND NEW.balance_after_cents >= threshold THEN NULL ELSE low_balance_alerted_at END
    WHERE tenant_id = NEW.tenant_id;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.apply_sms_ledger_entry() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER apply_sms_ledger_entry BEFORE INSERT ON public.sms_wallet_ledger FOR EACH ROW EXECUTE FUNCTION public.apply_sms_ledger_entry();
--> statement-breakpoint
-- sms_top_up_requests ----------------------------------------------------------------------------
ALTER TABLE public.sms_top_up_requests ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.sms_top_up_requests FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON public.sms_top_up_requests TO remix_app, remix_readonly USING (tenant_id = (SELECT public.app_tenant_id())) WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
--> statement-breakpoint
CREATE POLICY tenant_owner ON public.sms_top_up_requests TO remix_owner USING (tenant_id = (SELECT public.app_tenant_id())) WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
--> statement-breakpoint
REVOKE ALL ON public.sms_top_up_requests FROM remix_app, remix_readonly, remix_platform, PUBLIC;
--> statement-breakpoint
GRANT SELECT ON public.sms_top_up_requests TO remix_app, remix_readonly;
--> statement-breakpoint
-- Status and resolution are set by staff tooling (owner role); the app only files requests.
GRANT INSERT (tenant_id, amount_cents, requested_by) ON public.sms_top_up_requests TO remix_app;
--> statement-breakpoint
-- tenant_settings -----------------------------------------------------------------------------------
GRANT UPDATE (receipt_sms_enabled) ON public.tenant_settings TO remix_app;
