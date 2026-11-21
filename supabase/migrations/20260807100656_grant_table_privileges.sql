-- Recent Supabase defaults stopped auto-granting table privileges to the
-- Data API roles (config.toml: auto_expose_new_tables). RLS policies alone
-- aren't enough — Postgres still checks GRANTs first.
grant usage on schema public to authenticated;

grant select, insert, update, delete on public.recordings to authenticated;
grant select, insert, update, delete on public.entries to authenticated;
grant select, insert, update, delete on public.collections to authenticated;
grant select, insert, update, delete on public.collection_entries to authenticated;

grant execute on function public.match_entries(vector, int) to authenticated;
