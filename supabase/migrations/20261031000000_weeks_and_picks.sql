-- The weekly flow: each week the user submits 2 long-form videos to Opus, their clips get
-- scored, and the top 7 become the week's picks to schedule.

create table public.weeks (
  id uuid primary key default gen_random_uuid(),
  -- The Monday of the week, in America/New_York.
  starts_on date not null,
  created_at timestamptz not null default now()
);

comment on table public.weeks is
  'One row per weekly batch. The most recent row is the current week.';

create index weeks_created_at_idx on public.weeks (created_at desc);

alter table public.source_videos
  add column week_id uuid references public.weeks (id) on delete set null,
  add column opus_status text check (opus_status in ('submitted', 'processing', 'ready', 'failed')),
  add column opus_checked_at timestamptz;

comment on column public.source_videos.opus_status is
  'Where the Opus project is: submitted, processing, ready (clips synced), or failed. Null for videos synced by hand.';

create index source_videos_week_id_idx on public.source_videos (week_id);

alter table public.clips
  add column picked boolean not null default false;

comment on column public.clips.picked is
  'One of the week''s picks to schedule. Set automatically to the top 7 after scoring; the user can swap.';

alter table public.weeks enable row level security;

create policy "Authenticated users have full access" on public.weeks
  for all to authenticated using (true) with check (true);

grant select, insert, update, delete on public.weeks to service_role, authenticated;
