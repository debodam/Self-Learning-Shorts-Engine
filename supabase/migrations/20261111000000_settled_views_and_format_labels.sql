-- Settled views and Claude format labels for YouTube Shorts.

-- Settled views: the main performance number. Current views once a Short is older than
-- 30 days (Shorts mostly stop growing by then), otherwise its 7-day views once captured.
alter table public.youtube_shorts add column settled_views bigint check (settled_views >= 0);

-- Format labels come from Claude (title, description, and thumbnail) instead of a guess
-- from the title. The old guessed labels are dropped so every Short gets a fresh label.
alter table public.youtube_shorts
  drop column format,
  drop column format_guessed,
  add column thumbnail_url text,
  add column format text check (format in ('mock_interview', 'conversational', 'explainer', 'other')),
  add column format_confidence text check (format_confidence in ('high', 'medium', 'low')),
  add column format_reason text,
  add column format_model text,
  add column format_labeled_at timestamptz;

create index youtube_shorts_unlabeled_idx on public.youtube_shorts (video_id) where format is null;
