-- Columns the scheduled jobs need: which Opus project a source video became, clip length,
-- and the agent's predictions so weekly learnings can compare them with actual results.

alter table public.source_videos
  add column opus_project_id text unique;

alter table public.clips
  add column duration_seconds integer check (duration_seconds > 0),
  add column predicted_views_youtube integer check (predicted_views_youtube >= 0),
  add column predicted_views_tiktok integer check (predicted_views_tiktok >= 0),
  add column predicted_views_instagram integer check (predicted_views_instagram >= 0),
  add column score_reasoning text,
  add column scored_at timestamptz;

comment on column public.clips.predicted_views_youtube is
  'Views the agent predicted for the first 7 days on YouTube, set when the clip is scored.';
comment on column public.clips.scored_at is
  'When the agent last scored this clip. Null means not scored yet.';

-- Source videos submitted to Opus whose clips haven't been imported yet.
create index source_videos_opus_project_id_idx on public.source_videos (opus_project_id)
  where opus_project_id is not null;
