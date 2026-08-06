-- Run this once in Supabase SQL Editor to add savings tracking.
-- Safe to run alongside your existing tables.

create table if not exists savings_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  type text not null check (type in ('deposit', 'withdrawal')),
  amount numeric not null default 0,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_savings_transactions_date on savings_transactions(user_id, date);

alter table savings_transactions enable row level security;

create policy "own savings_transactions" on savings_transactions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
