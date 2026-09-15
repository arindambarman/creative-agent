-- Creative Agent — database schema
-- Run this in the Supabase SQL editor. Safe to run more than once.

-- Who is allowed to sign in. Add your friends' emails here before they try.
create table if not exists allowlist (
  email text primary key,
  added_at timestamptz default now()
);

create table if not exists profiles (
  id uuid primary key references auth.users on delete cascade,
  email text,
  display_name text,
  monthly_token_budget int default 1000000,
  created_at timestamptz default now()
);

-- The three studio brain documents, one row per user.
create table if not exists studio_docs (
  user_id uuid primary key references auth.users on delete cascade,
  voice text default '',
  work text default '',
  tools text default '',
  updated_at timestamptz default now()
);

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  name text not null default 'Untitled project',
  brief jsonb not null default '{}'::jsonb,
  archived boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists projects_user_idx on projects(user_id, updated_at desc);

-- Every run of every phase is kept, so you can compare attempts.
create table if not exists phase_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  phase text not null check (phase in ('discover','direct','plan','deliver','publish')),
  output text not null default '',
  is_current boolean default true,
  edited boolean default false,
  created_at timestamptz default now()
);
create index if not exists phase_runs_project_idx on phase_runs(project_id, phase, created_at desc);

-- Only one current run per phase per project.
create unique index if not exists phase_runs_current_idx
  on phase_runs(project_id, phase) where is_current;

-- Token usage, written by the edge function only, for monthly budget checks.
create table if not exists usage_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  phase text,
  input_tokens int default 0,
  output_tokens int default 0,
  created_at timestamptz default now()
);
create index if not exists usage_log_user_idx on usage_log(user_id, created_at desc);

-- Row-level security: every table filters by the signed-in user.
alter table profiles     enable row level security;
alter table studio_docs  enable row level security;
alter table projects     enable row level security;
alter table phase_runs   enable row level security;
alter table allowlist    enable row level security;
alter table usage_log    enable row level security;

-- Read-only for users: the monthly budget lives here, so only the owner (in the SQL editor)
-- or the service role may change it. The profile row itself is created by handle_new_user().
drop policy if exists own_profile on profiles;
drop policy if exists read_own_profile on profiles;
create policy read_own_profile on profiles
  for select using (auth.uid() = id);

drop policy if exists own_docs on studio_docs;
create policy own_docs on studio_docs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists own_projects on projects;
create policy own_projects on projects
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists own_runs on phase_runs;
create policy own_runs on phase_runs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists own_usage on usage_log;
create policy own_usage on usage_log for select using (auth.uid() = user_id);

-- Nobody reads the allowlist from the client; only the server-side trigger uses it.
drop policy if exists no_client_allowlist on allowlist;
create policy no_client_allowlist on allowlist for select using (false);

-- On first sign-in: reject anyone not on the allowlist, then seed their records.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if not exists (select 1 from allowlist where lower(email) = lower(new.email)) then
    raise exception 'This email is not on the allowlist.';
  end if;
  insert into profiles (id, email) values (new.id, new.email) on conflict do nothing;
  insert into studio_docs (user_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Keep updated_at honest.
create or replace function touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists projects_touch on projects;
create trigger projects_touch before update on projects
  for each row execute function touch_updated_at();

-- Usage this calendar month, for budget checks in the edge function.
create or replace function tokens_used_this_month(uid uuid)
returns bigint language sql stable as $$
  select coalesce(sum(input_tokens + output_tokens), 0)
  from usage_log
  where user_id = uid and created_at >= date_trunc('month', now());
$$;

-- Table permissions for signed-in users. Newer Supabase projects don't grant these
-- automatically; row-level security above still limits every row to its owner.
grant select, insert, update, delete on studio_docs, projects, phase_runs to authenticated;
grant select on profiles, usage_log to authenticated;
grant execute on function tokens_used_this_month(uuid) to authenticated;
revoke all on allowlist from anon, authenticated;
