-- Generalises "money owed back to you" so it isn't hardcoded to one person's
-- life. It used to be a fixed pair — 'work' or 'roommate' — which meant
-- anyone else running this app was stuck with two categories that may not
-- match their situation at all. Now it's a free-text name, the same way
-- personal_debts already works.
--
-- Your existing rows are preserved: 'work' becomes "Work" and 'roommate'
-- becomes "Roommate", and you can rename either with the ✎ button afterwards.
--
-- Run this once in Supabase SQL Editor. Safe to run more than once.

alter table reimbursements add column if not exists person text;

-- Backfill before anything starts depending on the new column.
update reimbursements
   set person = case owed_by
                  when 'work' then 'Work'
                  when 'roommate' then 'Roommate'
                  else coalesce(person, 'Someone')
                end
 where person is null;

alter table reimbursements alter column person set default 'Someone';

-- Only safe once every row has a name, which the backfill above guarantees.
do $$
begin
  if not exists (select 1 from reimbursements where person is null) then
    alter table reimbursements alter column person set not null;
  end if;
end $$;

-- The old enum column and its check constraint are what pinned this to two
-- specific categories. Dropping the column drops the constraint with it.
alter table reimbursements drop column if exists owed_by;

drop index if exists idx_reimbursements_user;
create index if not exists idx_reimbursements_user
  on reimbursements(user_id, settled, date);

-- ---------- Renameable "family maintenance" ----------
-- That name is specific to one household. The field itself is useful to
-- anyone — a fixed monthly commitment that isn't a normal bill — so the
-- column keeps its name and only the label shown on screen is configurable.
alter table user_settings add column if not exists family_label text;
update user_settings set family_label = 'Family Maintenance' where family_label is null;
