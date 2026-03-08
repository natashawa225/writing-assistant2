create extension if not exists "pgcrypto";

create table if not exists public.sessions (
  id uuid primary key,
  condition text not null check (condition in ('baseline', 'multilevel')),
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  reflective_summary text
);

create table if not exists public.issues (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,

  element_type text not null,

  issue_index integer not null,

  corrected_text text,
  initial_text text,
  original_text text,
  suggested_correction text
);

-- If an older schema added a check constraint, remove it to match this simplified schema.
alter table public.issues
  drop constraint if exists issues_element_type_check;

create table if not exists public.interaction_logs (
  id uuid primary key default gen_random_uuid(),

  session_id uuid not null
    references public.sessions(id) on delete cascade,

  issue_id uuid
    references public.issues(id) on delete set null,

  event_type text,
  
  feedback_level integer check (feedback_level in (1,2,3)),

  timestamp timestamptz not null default now(),

  metadata jsonb
);

-- If an older schema added a strict event check, remove it for the simplified schema.
alter table public.interaction_logs
  drop constraint if exists interaction_logs_event_type_check;

create table if not exists public.draft_snapshots (
  id uuid primary key default gen_random_uuid(),

  session_id uuid not null
    references public.sessions(id) on delete cascade,

  issue_id uuid
    references public.issues(id) on delete set null,

  stage text not null check (
    stage in ('initial', 'after_edit', 'final')
  ),

  draft_text text not null,

  timestamp timestamptz not null default now()
);

create index if not exists idx_issues_session_id
  on public.issues(session_id);

create index if not exists idx_logs_session_id
  on public.interaction_logs(session_id);

create index if not exists idx_logs_issue_id
  on public.interaction_logs(issue_id);

create index if not exists idx_snapshots_session_id
  on public.draft_snapshots(session_id);

create index if not exists idx_snapshots_issue_id
  on public.draft_snapshots(issue_id);

ALTER TABLE public.draft_snapshots
  DROP CONSTRAINT IF EXISTS draft_snapshots_stage_check;

ALTER TABLE public.draft_snapshots
  ADD CONSTRAINT draft_snapshots_stage_check
  CHECK (stage IN ('initial', 'after_edit', 'final'));

ALTER TABLE public.draft_snapshots
  ALTER COLUMN stage SET DEFAULT 'after_edit';

-- one initial snapshot per session
create unique index if not exists uniq_snapshots_initial_per_session
  on public.draft_snapshots(session_id)
  where stage = 'initial';

-- one final snapshot per session
create unique index if not exists uniq_snapshots_final_per_session
  on public.draft_snapshots(session_id)
  where stage = 'final';

-- useful for reads
create index if not exists idx_snapshots_session_stage_ts
  on public.draft_snapshots(session_id, stage, "timestamp" desc);

alter table sessions
add column student_name text,
add column student_id text;

alter table sessions
add column revision_window_minutes text