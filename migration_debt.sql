-- Run this once in Supabase SQL Editor to track finite debts (Zip, Latitude,
-- loans) rather than treating them as costs that recur forever.
-- Safe to run more than once.

-- The full amount owed when tracking started. Null means an ordinary
-- recurring cost. How much is left is derived from which months have been
-- ticked as paid, so there's no running balance to drift out of sync.
alter table fixed_expenses add column if not exists debt_total numeric;
