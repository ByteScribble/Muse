-- Muse: voice memory. Core schema.
create extension if not exists vector;

create table recordings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  audio_path text not null,
  duration_ms integer,
  status text not null default 'pending' check (status in ('pending', 'processing', 'done', 'error')),
  error text,
  created_at timestamptz not null default now()
);

create table entries (
  id uuid primary key default gen_random_uuid(),
  recording_id uuid not null unique references recordings(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  transcript text not null,
  title text,
  summary text,
  keywords text[] not null default '{}',
  topics text[] not null default '{}',
  people text[] not null default '{}',
  projects text[] not null default '{}',
  -- gemini-embedding-001, output_dimensionality pinned to 768 for a fixed-size ANN index
  embedding vector(768),
  created_at timestamptz not null default now()
);

create table collections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create table collection_entries (
  collection_id uuid not null references collections(id) on delete cascade,
  entry_id uuid not null references entries(id) on delete cascade,
  primary key (collection_id, entry_id)
);

create index recordings_user_id_idx on recordings(user_id);
create index entries_user_id_idx on entries(user_id);
create index entries_recording_id_idx on entries(recording_id);
create index collections_user_id_idx on collections(user_id);
create index entries_embedding_idx on entries using hnsw (embedding vector_cosine_ops);

alter table recordings enable row level security;
alter table entries enable row level security;
alter table collections enable row level security;
alter table collection_entries enable row level security;

create policy "own recordings" on recordings for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own entries" on entries for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own collections" on collections for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own collection_entries" on collection_entries for all
  using (exists (
    select 1 from collections c where c.id = collection_id and c.user_id = auth.uid()
  ));

-- Natural-language search: cosine similarity over the caller's own entries only.
create or replace function match_entries(
  query_embedding vector(768),
  match_count int default 10
)
returns table (
  id uuid,
  recording_id uuid,
  title text,
  summary text,
  transcript text,
  keywords text[],
  topics text[],
  created_at timestamptz,
  similarity float
)
language sql stable
security invoker
as $$
  select e.id, e.recording_id, e.title, e.summary, e.transcript, e.keywords, e.topics, e.created_at,
         1 - (e.embedding <=> query_embedding) as similarity
  from entries e
  where e.user_id = auth.uid()
  order by e.embedding <=> query_embedding
  limit match_count;
$$;

-- Audio blobs, one private bucket, path convention: {user_id}/{recording_id}.m4a
insert into storage.buckets (id, name, public)
values ('recordings', 'recordings', false)
on conflict (id) do nothing;

create policy "own audio read" on storage.objects for select
  using (bucket_id = 'recordings' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "own audio insert" on storage.objects for insert
  with check (bucket_id = 'recordings' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "own audio delete" on storage.objects for delete
  using (bucket_id = 'recordings' and auth.uid()::text = (storage.foldername(name))[1]);
