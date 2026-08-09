-- Run this once in Supabase SQL Editor to allow ticking off fixed expenses
-- and family maintenance once they've actually been paid.
-- Safe to run more than once.

-- Paid status is deliberately per-month: both tables are already scoped by
-- month, so a new month starts unpaid on its own and last month's ticks are
-- kept as history.
alter table fixed_expenses add column if not exists paid boolean not null default false;
alter table fixed_expenses add column if not exists paid_on date;

alter table monthly_data add column if not exists family_paid boolean not null default false;
alter table monthly_data add column if not exists family_paid_on date;
