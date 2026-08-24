-- Money YOU owe other people — a colleague who covered lunch, a manager who
-- fronted you cash. The mirror image of `reimbursements`, which is money owed
-- back TO you, and deliberately a separate table so the two can never be
-- summed together by accident.
--
-- Not the same thing as fixed_expenses.debt_total either: that is a finite
-- debt paid down in monthly instalments (Zip, Latitude, a loan). This is an
-- informal one-off IOU with no schedule.
--
-- Run this once in Supabase SQL Editor (Project -> SQL Editor -> New query).
-- Safe to run more than once.

create table if not exists personal_debts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- When you borrowed it / when they covered you.
  date date not null,
  -- Free text rather than a fixed set, so the next person you owe doesn't
  -- need a code change and another migration.
  person text not null,
  description text not null,
  amount numeric not null default 0,
  repaid boolean not null default false,
  -- The date you actually handed the money back. This is what decides which
  -- month the repayment counts as spending in, so it is not merely a record.
  repaid_on date,
  created_at timestamptz not null default now()
);

create index if not exists idx_personal_debts_user
  on personal_debts(user_id, repaid, date);

alter table personal_debts enable row level security;

-- `create policy` has no IF NOT EXISTS, hence the drop.
drop policy if exists "own personal_debts" on personal_debts;
create policy "own personal_debts" on personal_debts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
