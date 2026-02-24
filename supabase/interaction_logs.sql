create table if not exists public.interaction_logs (
  id bigint generated always as identity primary key,
  session_id text not null,
  "timestamp" timestamptz not null default now(),
  event_type text not null,
  essay_text text,
  feedback_level integer,
  metadata jsonb
);

create index if not exists interaction_logs_session_id_idx
  on public.interaction_logs (session_id);

alter table public.interaction_logs enable row level security;

-- Enable RLS
alter table public.interaction_logs enable row level security;

-- Drop policies if they exist
drop policy if exists interaction_logs_insert_all on public.interaction_logs;
drop policy if exists interaction_logs_select_all on public.interaction_logs;

-- Recreate policies
create policy interaction_logs_insert_all
  on public.interaction_logs
  for insert
  with check (true);

create policy interaction_logs_select_all
  on public.interaction_logs
  for select
  using (true);

create or replace function public.prevent_interaction_logs_update()
returns trigger
language plpgsql
as $$
begin
  raise exception 'interaction_logs is append-only; updates are not allowed';
end;
$$;

drop trigger if exists interaction_logs_no_update on public.interaction_logs;
create trigger interaction_logs_no_update
before update on public.interaction_logs
for each row execute function public.prevent_interaction_logs_update();
