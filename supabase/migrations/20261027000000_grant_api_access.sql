-- Supabase no longer grants API roles access to tables created in migrations, so the
-- service role (server code and scripts) got "permission denied". Grant it explicitly.
-- authenticated is still limited by the RLS policies in the initial schema. anon gets nothing.

grant select, insert, update, delete
  on public.source_videos, public.clips, public.posts, public.metrics, public.learnings
  to service_role, authenticated;
