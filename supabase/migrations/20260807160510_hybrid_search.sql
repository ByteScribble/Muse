-- Pure vector search cannot find proper nouns. Measured on real notes:
-- searching "Rahul" ranked the note that actually says "Rahul" third, behind
-- two that never mention him — a name carries almost no semantic signal, so
-- the embedding smears it across the corpus. Names, project codenames and
-- jargon are exactly what you search a personal memory for, so retrieval needs
-- a lexical half as well.

-- array_to_string is only STABLE (its generality allows type output functions
-- that read settings), so a generated column refuses it. Joining a text[] with
-- a literal separator genuinely is immutable, so we say so explicitly.
create or replace function muse_words(arr text[])
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$ select coalesce(array_to_string(arr, ' '), '') $$;

alter table entries add column fts tsvector
  generated always as (
    to_tsvector(
      -- The ::regconfig cast is load-bearing too: to_tsvector(text, text)
      -- resolves its config at runtime and so is only stable. Naming the
      -- config as a type makes it immutable.
      'english'::regconfig,
      coalesce(title, '') || ' ' ||
      coalesce(summary, '') || ' ' ||
      coalesce(transcript, '') || ' ' ||
      muse_words(keywords) || ' ' ||
      muse_words(topics) || ' ' ||
      muse_words(people) || ' ' ||
      muse_words(projects)
    )
  ) stored;

create index entries_fts_idx on entries using gin (fts);

-- Hybrid retrieval, fused with Reciprocal Rank Fusion. RRF combines rankings
-- rather than scores, so we never have to calibrate cosine distance against
-- ts_rank — two quantities that share no scale.
create or replace function search_entries(
  query_text text,
  query_embedding vector(768),
  match_count int default 10,
  -- Measured on the first real notes: unrelated pairs scored 0.198-0.264,
  -- genuine matches 0.352-0.483. 0.30 sits in that gap. Small sample — expect
  -- to revisit once there are hundreds of notes rather than a handful.
  similarity_floor float default 0.30,
  rrf_k int default 50
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
  similarity float,
  lexical_hit boolean
)
language sql stable
security invoker
-- Unquoted, so this is a two-schema list. Quoting it makes Postgres look for a
-- single schema literally named "public, extensions" and nothing resolves.
set search_path = public, extensions
as $$
  with semantic as (
    select e.id,
           1 - (e.embedding <=> query_embedding) as similarity,
           row_number() over (order by e.embedding <=> query_embedding) as rank
    from entries e
    where e.user_id = auth.uid() and e.embedding is not null
    order by e.embedding <=> query_embedding
    limit match_count * 4
  ),
  lexical as (
    select e.id,
           row_number() over (
             order by ts_rank_cd(e.fts, websearch_to_tsquery('english', query_text)) desc
           ) as rank
    from entries e
    where e.user_id = auth.uid()
      and e.fts @@ websearch_to_tsquery('english', query_text)
    limit match_count * 4
  ),
  fused as (
    select coalesce(s.id, l.id) as id,
           coalesce(s.similarity, 0) as similarity,
           l.id is not null as lexical_hit,
           coalesce(1.0 / (rrf_k + s.rank), 0) + coalesce(1.0 / (rrf_k + l.rank), 0) as score
    from semantic s
    full outer join lexical l on l.id = s.id
  )
  select e.id, e.recording_id, e.title, e.summary, e.transcript, e.keywords, e.topics,
         e.created_at, f.similarity, f.lexical_hit
  from fused f
  join entries e on e.id = f.id
  -- The floor is what stops "Kafka" returning four confident answers about
  -- retail and travel. An exact lexical hit always survives it: a rare word
  -- appearing verbatim is strong evidence even when the embedding disagrees.
  where f.lexical_hit or f.similarity >= similarity_floor
  order by f.score desc
  limit match_count;
$$;

grant execute on function public.search_entries(text, vector, int, float, int) to authenticated;
