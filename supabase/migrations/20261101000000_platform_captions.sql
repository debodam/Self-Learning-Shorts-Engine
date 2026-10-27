-- Posting to YouTube, TikTok, and Instagram through OpusClip: a caption per platform on
-- each clip (YouTube uses youtube_title and youtube_description), and which connected
-- account each post went to.

alter table public.clips
  add column tiktok_caption text,
  add column instagram_caption text,
  add column captions_generated_at timestamptz;

comment on column public.clips.captions_generated_at is
  'When the agent wrote the per-platform captions. Null until then.';

alter table public.posts
  add column account_name text;

comment on column public.posts.account_name is
  'The OpusClip connected account the post went to, for example "Exponent" or "Aced (formerly Exponent)".';
