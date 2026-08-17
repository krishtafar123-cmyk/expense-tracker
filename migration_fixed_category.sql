-- Run this once in Supabase SQL Editor to let a fixed expense act as a
-- spending allowance ("envelope") for a daily-expense category.
-- Safe to run more than once.

-- When set, daily expenses in this category draw down this allowance instead
-- of adding on top of it. Null means the row is an ordinary fixed cost.
alter table fixed_expenses add column if not exists category text;
