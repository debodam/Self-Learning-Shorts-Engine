-- What the scorer saw in the clip's frames, and why a clip was cut when it wasn't the
-- rubric. Frames are sampled at about 10%, 50%, and 90% through the clip.

alter table public.clips
  add column frames_checked smallint check (frames_checked between 0 and 10),
  add column face_frames smallint check (face_frames >= 0),
  add column people_count smallint check (people_count >= 0),
  add column text_readable boolean,
  add column cut_reason text;

comment on column public.clips.face_frames is
  'How many of the sampled frames show a person''s face clearly. Null when frames could not be checked.';
comment on column public.clips.cut_reason is
  'Why the clip was cut when a hard rule overrode the rubric, for example "No speaker on screen". Null otherwise.';
