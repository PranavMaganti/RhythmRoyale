-- Rhythm Royale database schema. The server applies this on startup, and every
-- statement is idempotent, so it is safe to run repeatedly or by hand (for
-- example in the Supabase SQL editor).

create table if not exists public.daily_scores (
  date date not null,
  -- Anonymous per-browser id: one leaderboard entry per player per day.
  token text not null check (char_length(token) between 8 and 64),
  name text not null check (char_length(name) between 1 and 16),
  total smallint not null check (total between 0 and 500),
  scores smallint[] not null,
  created_at timestamptz not null default now(),
  primary key (date, token)
);

create index if not exists daily_scores_date_total_idx
  on public.daily_scores (date, total desc);

-- Only the game server may read or write scores (it re-scores every
-- submission, so clients must never write directly). On Supabase the table
-- would otherwise be reachable through the public API with the anon key:
-- row level security with no policies blocks that, and the grants are removed
-- as well. The server connects as the table owner, which RLS doesn't restrict.
alter table public.daily_scores enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table public.daily_scores from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table public.daily_scores from authenticated;
  end if;
end
$$;
