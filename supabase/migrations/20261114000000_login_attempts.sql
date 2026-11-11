-- Password gate rate limiting: 5 wrong passwords lock an IP out for 15 minutes. Kept in
-- Supabase because Vercel runs many short-lived server instances that don't share
-- memory. IPs are stored as SHA-256 hashes, never raw.

create table public.login_attempts (
  ip_hash text primary key,
  failures integer not null default 0 check (failures >= 0),
  last_failed_at timestamptz,
  locked_until timestamptz
);

alter table public.login_attempts enable row level security;
-- No policies: only the server (service role) reads or writes it.
grant select, insert, update, delete on public.login_attempts to service_role;
