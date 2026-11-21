-- The notes list watches for enrichment landing ("Transcribing…" → the real
-- title). postgres_changes only fires for tables in this publication, and new
-- tables are not added to it automatically.
alter publication supabase_realtime add table public.recordings;
alter publication supabase_realtime add table public.entries;

-- Realtime sends the old row's primary key on DELETE, but a payload with the
-- changed columns needs REPLICA IDENTITY FULL to include anything else.
alter table public.recordings replica identity full;
alter table public.entries replica identity full;
