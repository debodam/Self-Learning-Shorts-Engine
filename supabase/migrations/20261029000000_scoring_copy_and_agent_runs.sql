-- What the scoring agent writes besides the rubric: a factual title and the YouTube copy.
-- score_reasoning (from the agent_predictions migration) holds the one-line reason.
-- Plus a log of agent runs so the token cost of each run is on record.

alter table public.clips
  add column suggested_title text,
  add column youtube_title text,
  add column youtube_description text;

comment on column public.clips.suggested_title is
  'Factual title the agent suggests when it scores the clip. title keeps the original from Opus.';

-- agent_runs ----------------------------------------------------------------

create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  model text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  items_processed integer not null default 0 check (items_processed >= 0),
  items_failed integer not null default 0 check (items_failed >= 0),
  input_tokens bigint not null default 0 check (input_tokens >= 0),
  output_tokens bigint not null default 0 check (output_tokens >= 0),
  cache_read_input_tokens bigint not null default 0 check (cache_read_input_tokens >= 0),
  cache_creation_input_tokens bigint not null default 0 check (cache_creation_input_tokens >= 0),
  cost_usd numeric(10, 4),
  error text
);

comment on table public.agent_runs is
  'One row per agent run (for example kind = ''scoring''), with token usage and estimated cost.';
comment on column public.agent_runs.cost_usd is
  'Estimated from token counts and the model''s list price at the time of the run.';

create index agent_runs_kind_started_at_idx on public.agent_runs (kind, started_at desc);

alter table public.agent_runs enable row level security;

create policy "Authenticated users have full access" on public.agent_runs
  for all to authenticated using (true) with check (true);

grant select, insert, update, delete on public.agent_runs to service_role, authenticated;
