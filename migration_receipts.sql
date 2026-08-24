-- Receipt photos for daily expenses and work purchases.
-- Run this once in Supabase SQL Editor (Project -> SQL Editor -> New query).
-- Safe to run more than once.

alter table daily_expenses add column if not exists receipt_path text;
alter table reimbursements add column if not exists receipt_path text;

-- A private bucket: nothing in here is reachable without a signed URL, which
-- the app mints per view and lets expire. The size cap and the image-only
-- allow-list are enforced by Storage itself, so a bad upload is rejected at
-- the door instead of being something the client has to police.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 5242880,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Every object is stored under a folder named after its owner's user id, so
-- "the first path segment is my own uid" is the entire access rule. Same
-- shape as the RLS on the tables: you can only ever reach your own rows.
-- `create policy` has no IF NOT EXISTS, hence the drops.
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
