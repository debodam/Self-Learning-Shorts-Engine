-- One caption per clip, posted as is to YouTube, TikTok, and Instagram: the factual
-- title, 1 to 2 lines of context, and 3 to 5 hashtags. Replaces the per-platform
-- tiktok_caption and instagram_caption, which are left in place but no longer used.

alter table public.clips
  add column caption text;

comment on column public.clips.caption is
  'The caption posted to every platform: factual title, 1 to 2 lines of context, 3 to 5 hashtags. Its first line is the post title.';
