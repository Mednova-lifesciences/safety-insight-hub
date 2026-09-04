-- Found in live UI testing: the WhatsApp inbox's conversation-list
-- subscription (added in the "make the list live" fix) subscribes to
-- postgres_changes on pv_intake_conversations, but that table was never
-- added to the supabase_realtime publication — only pv_intake_messages
-- was, in 018_whatsapp_intake.sql. The subscription silently receives
-- nothing: no error, just no events, so a status change (e.g.
-- terminating a conversation) never refreshed the sidebar without a
-- manual reload.
alter publication supabase_realtime add table public.pv_intake_conversations;
