-- Rollback of 20261030120000_psur_set_v4_prefill.sql. Deploy the app
-- version that saves the pre-fill with the whole document first, or the
-- pre-fill save fails.
drop function if exists public.psur_set_v4_prefill(text, jsonb);
