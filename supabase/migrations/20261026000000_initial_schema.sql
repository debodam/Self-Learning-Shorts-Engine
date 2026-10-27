-- Initial schema: source videos, clips, posts, metrics, and weekly learnings.

create extension if not exists vector with schema extensions;

-- Enums ---------------------------------------------------------------------

create type public.clip_format as enum ('mock', 'conversational');

create type public.clip_status as enum ('candidate', 'approved', 'rejected', 'scheduled', 'posted');

create type public.platform as enum ('youtube', 'tiktok', 'instagram');

create type public.post_status as enum ('scheduled', 'posted', 'failed', 'canceled');

-- source_videos -------------------------------------------------------------

create table public.source_videos (
  id uuid primary key default gen_random_uuid(),
  youtube_url text not null unique,
  title text not null,
  duration_seconds integer check (duration_seconds > 0),
  channel text not null,
  created_at timestamptz not null default now()
);

create index source_videos_channel_idx on public.source_videos (channel);

-- clips ---------------------------------------------------------------------

create table public.clips (
  id uuid primary key default gen_random_uuid(),
  source_video_id uuid not null references public.source_videos (id) on delete cascade,
  opus_clip_id text unique,
  title text not null,
  hook text,
  transcript text,
  format public.clip_format not null,
  hook_type text,
  -- Rubric, 1 to 5 each. Null until the agent has scored the clip.
  score_hook smallint check (score_hook between 1 and 5),
  score_tension smallint check (score_tension between 1 and 5),
  score_standalone smallint check (score_standalone between 1 and 5),
  score_payoff smallint check (score_payoff between 1 and 5),
  score_loopability smallint check (score_loopability between 1 and 5),
  score_total smallint generated always as (
    score_hook + score_tension + score_standalone + score_payoff + score_loopability
  ) stored,
  status public.clip_status not null default 'candidate',
  embedding extensions.vector(1024),
  created_at timestamptz not null default now()
);

comment on column public.clips.embedding is
  'Clip embedding for similar-clip retrieval. 1024 dimensions is a placeholder: it must match the output size of the embedding model chosen in Phase 3. Change the column and the HNSW index together if the model differs.';

comment on column public.clips.score_total is
  'Sum of the five rubric scores (5 to 25). Null until all five are set.';

create index clips_source_video_id_idx on public.clips (source_video_id);
create index clips_status_created_at_idx on public.clips (status, created_at desc);
create index clips_embedding_idx on public.clips
  using hnsw (embedding extensions.vector_cosine_ops);

-- posts ---------------------------------------------------------------------

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  clip_id uuid not null references public.clips (id) on delete cascade,
  platform public.platform not null,
  platform_post_id text,
  scheduled_for timestamptz,
  posted_at timestamptz,
  caption text,
  status public.post_status not null default 'scheduled',
  created_at timestamptz not null default now(),
  -- One post per clip per platform.
  unique (clip_id, platform),
  unique (platform, platform_post_id)
);

create index posts_clip_id_idx on public.posts (clip_id);
create index posts_scheduled_for_idx on public.posts (scheduled_for)
  where status = 'scheduled';
create index posts_platform_posted_at_idx on public.posts (platform, posted_at desc);

-- metrics -------------------------------------------------------------------

-- One row per snapshot. Platforms that don't report a field leave it null.
create table public.metrics (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  captured_at timestamptz not null default now(),
  views bigint check (views >= 0),
  avg_percent_watched numeric(5, 2) check (avg_percent_watched between 0 and 100),
  shares integer check (shares >= 0),
  saves integer check (saves >= 0),
  follows_gained integer check (follows_gained >= 0),
  comments integer check (comments >= 0)
);

create index metrics_post_id_captured_at_idx on public.metrics (post_id, captured_at desc);

-- learnings -----------------------------------------------------------------

create table public.learnings (
  id uuid primary key default gen_random_uuid(),
  week_start date not null unique,
  what_worked text[] not null default '{}',
  what_changed text[] not null default '{}',
  reasoning text not null,
  created_at timestamptz not null default now()
);

-- Row level security ----------------------------------------------------------

-- Any signed-in user has full access. Server jobs use the service role, which bypasses RLS.
-- Tighten these if teammates get different roles later.
alter table public.source_videos enable row level security;
alter table public.clips enable row level security;
alter table public.posts enable row level security;
alter table public.metrics enable row level security;
alter table public.learnings enable row level security;

create policy "Authenticated users have full access" on public.source_videos
  for all to authenticated using (true) with check (true);
create policy "Authenticated users have full access" on public.clips
  for all to authenticated using (true) with check (true);
create policy "Authenticated users have full access" on public.posts
  for all to authenticated using (true) with check (true);
create policy "Authenticated users have full access" on public.metrics
  for all to authenticated using (true) with check (true);
create policy "Authenticated users have full access" on public.learnings
  for all to authenticated using (true) with check (true);
