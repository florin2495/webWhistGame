-- Pending kick: during a running game the host's kick starts a 10 s countdown instead of removing
-- the player at once. null = no pending kick. Run once in the Supabase SQL editor.
alter table public.whist_players add column if not exists kick_requested_at timestamptz;
