-- Run this once in Supabase SQL Editor to add per-category monthly budgets.
-- Safe to run more than once.

create table if not exists category_budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null,
  amount numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, category)
);

create index if not exists idx_category_budgets_user on category_budgets(user_id);

alter table category_budgets enable row level security;

drop policy if exists "own category_budgets" on category_budgets;
create policy "own category_budgets" on category_budgets
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
