-- Post again: a clip can be posted to the same platform more than once, and every post is
-- kept for history and metrics. Only one *scheduled* post per clip and platform at a time.

alter table public.posts drop constraint if exists posts_clip_id_platform_key;

create unique index posts_one_scheduled_per_clip_platform
  on public.posts (clip_id, platform)
  where status = 'scheduled';
