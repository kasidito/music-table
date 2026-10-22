-- Private bucket for transfer slip photos. Active staff upload and view; managers delete.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('slips', 'slips', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy slips_staff_read on storage.objects for select to authenticated
  using (bucket_id = 'slips' and public.is_active_staff());
create policy slips_staff_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'slips' and public.is_active_staff());
create policy slips_manager_delete on storage.objects for delete to authenticated
  using (bucket_id = 'slips' and public.is_manager());
