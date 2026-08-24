-- Run this once in your Supabase project's SQL Editor
-- (Project → SQL Editor → New query → paste → Run)

create extension if not exists pgcrypto;

create table if not exists monthly_data (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  month date not null,
  family_maintenance numeric not null default 0,
  family_paid boolean not null default false,
  family_paid_on date,
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
  category text,
  debt_total numeric,
  paid boolean not null default false,
  paid_on date,
  created_at timestamptz not null default now()
);

create table if not exists daily_expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  category text not null default 'Other',
  amount numeric not null default 0,
  note text,
  -- Object path in the private `receipts` bucket, set up at the end of this
  -- file. Null means no photo was attached.
  receipt_path text,
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
-- One row per user. A general settings home, not a single-purpose table.
create table if not exists user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  save_per_cycle numeric not null default 0,
  updated_at timestamptz not null default now()
);

-- Money you laid out that someone owes back to you. Kept apart from
-- daily_expenses on purpose: it must never count as your own spending.
create table if not exists reimbursements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  owed_by text not null check (owed_by in ('work', 'roommate')),
  description text not null,
  amount numeric not null default 0,
  settled boolean not null default false,
  settled_on date,
  -- Deleted automatically once the claim is cleared: the photo only exists to
  -- get the money back, so it stops earning its keep the moment it arrives.
  receipt_path text,
  created_at timestamptz not null default now()
);

create index if not exists idx_reimbursements_user on reimbursements(user_id, owed_by, settled, date);
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
alter table reimbursements enable row level security;
alter table user_settings enable row level security;

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

drop policy if exists "own user_settings" on user_settings;
create policy "own user_settings" on user_settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own reimbursements" on reimbursements;
create policy "own reimbursements" on reimbursements
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------- Receipt photo storage ----------
-- A private bucket: nothing here is reachable without a signed URL, which the
-- app mints per view and lets expire. The size cap and image-only allow-list
-- are enforced by Storage itself, so a bad upload is rejected at the door.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 5242880,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Every object lives under a folder named after its owner's user id, so "the
-- first path segment is my own uid" is the entire access rule.
drop policy if exists "own receipts read" on storage.objects;
create policy "own receipts read" on storage.objects
  for select using (
    bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "own receipts write" on storage.objects;
create policy "own receipts write" on storage.objects
  for insert with check (
    bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "own receipts update" on storage.objects;
create policy "own receipts update" on storage.objects
  for update using (
    bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "own receipts delete" on storage.objects;
create policy "own receipts delete" on storage.objects
  for delete using (
    bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text
  );
