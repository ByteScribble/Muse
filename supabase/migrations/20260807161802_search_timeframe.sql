-- "What did I record yesterday" returned nothing: dates live in a column, not
-- in the embedding, so no amount of semantic similarity can answer a question
-- about *when*. The caller parses the phrase (it knows the user's timezone;
-- this server does not) and passes an explicit window.
--
-- A purely temporal query has no content to rank, so `relevance_optional`
-- turns the search into a plain chronological listing of the window.
create or replace function search_entries(
  query_text text,
  query_embedding vector(768),
  match_count int default 10,
  similarity_floor float default 0.30,
  rrf_k int default 50,
  after timestamptz default null,
  before timestamptz default null,
  relevance_optional boolean default false
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
set search_path = public, extensions
as $$
  with in_window as (
    select e.*
    from entries e
    where e.user_id = auth.uid()
      and (after is null or e.created_at >= after)
      and (before is null or e.created_at < before)
  ),
  semantic as (
    select w.id,
           1 - (w.embedding <=> query_embedding) as similarity,
           row_number() over (order by w.embedding <=> query_embedding) as rank
    from in_window w
    where w.embedding is not null
    order by w.embedding <=> query_embedding
    limit match_count * 4
  ),
  lexical as (
    select w.id,
           row_number() over (
             order by ts_rank_cd(w.fts, websearch_to_tsquery('english', query_text)) desc
           ) as rank
    from in_window w
    where w.fts @@ websearch_to_tsquery('english', query_text)
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
  select w.id, w.recording_id, w.title, w.summary, w.transcript, w.keywords, w.topics,
         w.created_at,
         coalesce(f.similarity, 0),
         coalesce(f.lexical_hit, false)
  from in_window w
  left join fused f on f.id = w.id
  where
    case
      -- "what did I record yesterday": everything in the window is an answer.
      when relevance_optional then true
      else f.id is not null and (f.lexical_hit or f.similarity >= similarity_floor)
    end
  order by
    case when relevance_optional then null else f.score end desc nulls last,
    w.created_at desc
  limit match_count;
$$;

grant execute on function
  public.search_entries(text, vector, int, float, int, timestamptz, timestamptz, boolean)
  to authenticated;

-- The five-argument version is now unreachable from the client; drop it so
-- there is exactly one definition of how search works.
drop function if exists public.search_entries(text, vector, int, float, int);
drop function if exists public.match_entries(vector, int);
