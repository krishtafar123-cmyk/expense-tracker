-- Run this once in Supabase SQL Editor to enable the savings target
-- ("pay yourself first") and the safe-to-spend figure that depends on it.
-- Safe to run more than once.

-- One row per user. A general settings home rather than a single-purpose
-- table, so later preferences have somewhere obvious to live.
create table if not exists user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  save_per_cycle numeric not null default 0,
  updated_at timestamptz not null default now()
);

alter table user_settings enable row level security;

drop policy if exists "own user_settings" on user_settings;
create policy "own user_settings" on user_settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
