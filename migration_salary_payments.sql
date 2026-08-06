-- Run this once in Supabase SQL Editor to add fortnightly-style salary tracking.
-- Safe to run even though you already ran schema.sql before.

create table if not exists salary_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  amount numeric not null default 0,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_salary_payments_date on salary_payments(user_id, date);

alter table salary_payments enable row level security;

drop policy if exists "own salary_payments" on salary_payments;
create policy "own salary_payments" on salary_payments
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- The old single monthly "salary" figure is replaced by dated payments above.
alter table monthly_data drop column if exists salary;
