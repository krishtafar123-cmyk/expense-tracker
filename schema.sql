-- Run this once in your Supabase project's SQL Editor
-- (Project → SQL Editor → New query → paste → Run)

create extension if not exists pgcrypto;

create table if not exists monthly_data (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  month date not null,
  family_maintenance numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, month)
);

create table if not exists fixed_expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  month date not null,
  name text not null,
  amount numeric not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists daily_expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  category text not null default 'Other',
  amount numeric not null default 0,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists salary_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  amount numeric not null default 0,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists savings_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  type text not null check (type in ('deposit', 'withdrawal')),
  amount numeric not null default 0,
  note text,
  created_at timestamptz not null default now()
);

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
create index if not exists idx_fixed_expenses_month on fixed_expenses(user_id, month);
create index if not exists idx_daily_expenses_date on daily_expenses(user_id, date);
create index if not exists idx_salary_payments_date on salary_payments(user_id, date);
create index if not exists idx_savings_transactions_date on savings_transactions(user_id, date);

alter table monthly_data enable row level security;
alter table fixed_expenses enable row level security;
alter table daily_expenses enable row level security;
alter table salary_payments enable row level security;
alter table savings_transactions enable row level security;
alter table category_budgets enable row level security;

drop policy if exists "own monthly_data" on monthly_data;
create policy "own monthly_data" on monthly_data
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own fixed_expenses" on fixed_expenses;
create policy "own fixed_expenses" on fixed_expenses
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own daily_expenses" on daily_expenses;
create policy "own daily_expenses" on daily_expenses
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own salary_payments" on salary_payments;
create policy "own salary_payments" on salary_payments
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own savings_transactions" on savings_transactions;
create policy "own savings_transactions" on savings_transactions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own category_budgets" on category_budgets;
create policy "own category_budgets" on category_budgets
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
