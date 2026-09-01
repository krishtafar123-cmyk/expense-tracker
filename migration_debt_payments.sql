-- Part payments against money you owe someone.
--
-- Until now a personal debt was all-or-nothing: `repaid` was a boolean, so a
-- $7,000 debt could only be "not paid" or "paid". Paying $500 off it had
-- nowhere to go. Payments now live in their own table and what's left is
-- derived from them, the same way the Debt Payoff card derives what's left
-- from paid ticks rather than storing a balance that can drift.
--
-- Run this once in Supabase SQL Editor. Safe to run more than once.

create table if not exists debt_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Deleting a debt takes its payments with it; an orphaned payment would
  -- silently distort what you've spent.
  debt_id uuid not null references personal_debts(id) on delete cascade,
  -- The date the money actually moved. This decides which month wears the
  -- cost, exactly as `repaid_on` used to for the whole debt.
  date date not null,
  amount numeric not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_debt_payments_debt on debt_payments(user_id, debt_id, date);

alter table debt_payments enable row level security;

drop policy if exists "own debt_payments" on debt_payments;
create policy "own debt_payments" on debt_payments
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Backfill before dropping anything: a debt already ticked as repaid becomes
-- a single payment for its full amount, dated when it was repaid. That
-- reproduces the old figures exactly, so no month's spending changes.
insert into debt_payments (user_id, debt_id, date, amount)
select pd.user_id, pd.id, coalesce(pd.repaid_on, pd.date), pd.amount
  from personal_debts pd
 where pd.repaid = true
   and not exists (select 1 from debt_payments p where p.debt_id = pd.id);

-- `repaid` and `repaid_on` are now derived from the payments. Leaving them
-- would be a second source of truth, and the one that goes stale first.
-- Guarded so a re-run doesn't fail once they're already gone.
alter table personal_debts drop column if exists repaid;
alter table personal_debts drop column if exists repaid_on;
