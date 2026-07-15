- 生产热修：补齐 Nest 预警模块所需结构。
-- 本文件与 migrations/20260715114000_alerts.sql 保持一致，可直接在 Supabase SQL Editor 执行。
do $$ begin
  create type public.alert_records_alert_type_enum as enum (
    'high_fail_rate', 'overdue_task', 'pending_audit', 'data_archived'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.alert_records_severity_enum as enum ('info', 'warning', 'critical');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.alert_records_status_enum as enum ('open', 'resolved');
exception when duplicate_object then null;
end $$;

create table if not exists public.alert_configs (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null unique references public.sites(id) on delete cascade,
  fail_rate_threshold double precision not null default 25,
  overdue_days integer not null default 3,
  enabled boolean not null default true,
  notify_emails jsonb,
  webhook_url varchar(512),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.alert_records (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  alert_type public.alert_records_alert_type_enum not null,
  severity public.alert_records_severity_enum not null default 'warning',
  title varchar(255) not null,
  message text not null,
  status public.alert_records_status_enum not null default 'open',
  metadata jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists idx_alert_records_site on public.alert_records(site_id);
create index if not exists idx_alert_records_status on public.alert_records(status);
create index if not exists idx_alert_records_created_at on public.alert_records(created_at desc);

alter table public.alert_configs enable row level security;
alter table public.alert_records enable row level security;

