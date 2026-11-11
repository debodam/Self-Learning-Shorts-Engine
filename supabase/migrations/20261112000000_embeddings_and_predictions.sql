-- MVP 2 memory: Voyage embeddings for clips and channel Shorts, similar-Short search, and
-- view predictions from similar Shorts' settled views.
--
-- voyage-4-large returns 1024 dimensions by default, which matches clips.embedding, so
-- that column and its HNSW index stay as they are.

comment on column public.clips.embedding is
  'Voyage voyage-4-large embedding (1024 dimensions) of the clip''s format, title, headline, and transcript. Must match youtube_shorts.embedding.';

alter table public.clips
  add column embedding_model text,
  add column embedded_at timestamptz,
  -- Predicted settled views from the 5 most similar past Shorts, set when scored.
  add column predicted_views_low integer check (predicted_views_low >= 0),
  add column predicted_views_expected integer check (predicted_views_expected >= 0),
  add column predicted_views_high integer check (predicted_views_high >= 0),
  add column prediction_reason text,
  -- The similar Shorts the prediction used: [{video_id, title, settled_views, similarity}].
  add column similar_shorts jsonb;

alter table public.youtube_shorts
  add column embedding extensions.vector(1024),
  add column embedding_model text,
  add column embedded_at timestamptz;

comment on column public.youtube_shorts.embedding is
  'Voyage voyage-4-large embedding (1024 dimensions) of the Short''s format, title, and description. Must match clips.embedding.';

create index youtube_shorts_embedding_idx on public.youtube_shorts
  using hnsw (embedding extensions.vector_cosine_ops);

-- The most similar Shorts to an embedding, among Shorts with settled views that are at
-- least min_age_days old. Skips the Short a given clip was posted as, so a posted clip
-- never compares against itself.
create or replace function public.match_similar_shorts(
  query_embedding extensions.vector(1024),
  match_count integer default 5,
  min_age_days integer default 7,
  exclude_clip_id uuid default null
)
returns table (
  video_id text,
  title text,
  format text,
  published_at timestamptz,
  settled_views bigint,
  similarity double precision
)
language sql
stable
set search_path = public, extensions
as $$
  select s.video_id, s.title, s.format, s.published_at, s.settled_views,
         1 - (s.embedding <=> query_embedding) as similarity
  from public.youtube_shorts s
  left join public.posts p on p.id = s.post_id
  where s.embedding is not null
    and s.settled_views is not null
    and s.published_at <= now() - make_interval(days => min_age_days)
    and (exclude_clip_id is null or p.clip_id is distinct from exclude_clip_id)
  order by s.embedding <=> query_embedding
  limit match_count;
$$;

grant execute on function public.match_similar_shorts(extensions.vector, integer, integer, uuid) to service_role, authenticated;
