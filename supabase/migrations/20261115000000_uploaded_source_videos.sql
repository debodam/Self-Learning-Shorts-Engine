-- Source videos can be an uploaded file instead of a YouTube link. An upload has no
-- YouTube URL; it's identified by its OpusClip upload ID instead.

alter table public.source_videos alter column youtube_url drop not null;

alter table public.source_videos
  add column upload_id text unique,
  add column upload_file_name text,
  add constraint source_videos_has_source check (youtube_url is not null or upload_id is not null);

comment on column public.source_videos.upload_id is 'OpusClip upload ID when the video was uploaded as a file rather than linked from YouTube.';
