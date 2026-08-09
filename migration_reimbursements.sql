-- Run this once in Supabase SQL Editor to add the "money owed back to you"
-- reminders: work purchases to claim from your manager, and money lent to your
-- roommate. Deliberately a separate table from daily_expenses so none of it is
-- ever counted as your own spending.
-- Safe to run more than once.

create table if not exists reimbursements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  owed_by text not null check (owed_by in ('work', 'roommate')),
  description text not null,
  amount numeric not null default 0,
  settled boolean not null default false,
  settled_on date,
  created_at timestamptz not null default now()
);

-- In case an earlier version of this table was already created.
alter table reimbursements add column if not exists settled_on date;

create index if not exists idx_reimbursements_user
  on reimbursements(user_id, owed_by, settled, date);

alter table reimbursements enable row level security;

drop policy if exists "own reimbursements" on reimbursements;
create policy "own reimbursements" on reimbursements
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
