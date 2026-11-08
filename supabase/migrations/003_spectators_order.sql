-- Spectators, join queue and host-chosen seat order (feedback 2, 1, 12).
--  role:      'player' (in the lobby list / seated in the game) or 'spectator' (joined a running game or a full room)
--  seat:      play order among the players (host reorders it); null = fall back to join order
--  queued_at: set while a spectator waits for "Intră la runda următoare"; the queue is ordered by it
-- Additive and idempotent. Run once in the Supabase SQL editor.
alter table public.whist_players add column if not exists role text not null default 'player';
alter table public.whist_players add column if not exists seat integer;
alter table public.whist_players add column if not exists queued_at timestamptz;
do $$ begin
  alter table public.whist_players
    add constraint whist_players_role_check check (role in ('player', 'spectator'));
exception when duplicate_object then null; end $$;
update public.whist_players p set seat = s.rn
  from (select id, row_number() over (partition by room_id order by joined_at) - 1 as rn from public.whist_players) s
  where p.id = s.id and p.seat is null;
