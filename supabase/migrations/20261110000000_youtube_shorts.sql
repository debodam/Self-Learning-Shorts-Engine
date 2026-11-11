-- MVP 2: YouTube Shorts on the channel, their metrics snapshots, and links to our posts.
-- Public Data API only (API key): views, likes, and comments. No retention or subscribers.

create table public.youtube_shorts (
  video_id text primary key,
  title text not null,
  description text not null default '',
  published_at timestamptz not null,
  duration_seconds integer not null check (duration_seconds >= 0),
  -- Latest pull.
  views bigint not null default 0 check (views >= 0),
  likes bigint check (likes >= 0),
  comments bigint check (comments >= 0),
  last_pulled_at timestamptz not null default now(),
  -- Views 48 hours and 7 days after publish, from snapshots near those marks.
  -- Null when no snapshot was taken close enough to the mark.
  views_48h bigint check (views_48h >= 0),
  views_7d bigint check (views_7d >= 0),
  -- 'mock' or 'conversational'. From the clip when the Short came from our pipeline,
  -- otherwise guessed from the title and description.
  format public.clip_format,
  format_guessed boolean not null default true,
  -- Set when the Short is one we posted through the dashboard.
  post_id uuid unique references public.posts (id) on delete set null,
  created_at timestamptz not null default now()
);

create index youtube_shorts_published_at_idx on public.youtube_shorts (published_at desc);

create table public.youtube_short_snapshots (
  id uuid primary key default gen_random_uuid(),
  video_id text not null references public.youtube_shorts (video_id) on delete cascade,
  captured_at timestamptz not null default now(),
  views bigint not null check (views >= 0),
  likes bigint check (likes >= 0),
  comments bigint check (comments >= 0),
  unique (video_id, captured_at)
);

create index youtube_short_snapshots_video_idx on public.youtube_short_snapshots (video_id, captured_at);

-- Posts we sent to YouTube that couldn't be matched to a Short on the channel.
alter table public.posts add column match_note text;

alter table public.youtube_shorts enable row level security;
alter table public.youtube_short_snapshots enable row level security;

create policy "Authenticated users have full access" on public.youtube_shorts
  for all to authenticated using (true) with check (true);
create policy "Authenticated users have full access" on public.youtube_short_snapshots
  for all to authenticated using (true) with check (true);

grant select, insert, update, delete
  on public.youtube_shorts, public.youtube_short_snapshots
  to service_role, authenticated;
