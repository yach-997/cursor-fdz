-- 光伏储能巡检：Supabase Postgres 初始结构（对齐 Nest/TypeORM）
create extension if not exists "pgcrypto";

-- users
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  password text not null,
  real_name text not null,
  phone text not null unique,
  email text,
  avatar text,
  role text not null,
  roles jsonb not null default '[]'::jsonb,
  status text not null default 'active',
  region text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- sites
create table if not exists public.sites (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique,
  province text not null default '',
  city text not null default '',
  district text not null default '',
  address text not null default '',
  latitude numeric(10,7) not null default 0,
  longitude numeric(10,7) not null default 0,
  manager_id uuid references public.users(id) on delete set null,
  status text not null default 'active',
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

-- site_members
create table if not exists public.site_members (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  member_role text not null default 'inspector',
  status text not null default 'active',
  joined_at timestamptz not null default now(),
  unique (site_id, user_id)
);

-- devices
create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete restrict,
  serial_number text not null unique,
  device_type text not null,
  model text,
  manufacturer text,
  install_date date,
  status text not null default 'active',
  created_at timestamptz not null default now()
);

-- inspection_templates
create table if not exists public.inspection_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  device_type text not null,
  entries jsonb not null default '[]'::jsonb,
  is_global boolean not null default true,
  site_id uuid references public.sites(id) on delete cascade,
  version int not null default 1,
  created_at timestamptz not null default now()
);

-- inspection_tasks
create table if not exists public.inspection_tasks (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id),
  device_id uuid not null references public.devices(id),
  task_name text not null,
  inspector_id uuid not null references public.users(id),
  created_by uuid not null references public.users(id),
  status text not null default 'pending',
  planned_date date,
  started_at timestamptz,
  completed_at timestamptz,
  ai_enabled boolean not null default true,
  template_snapshot jsonb,
  created_at timestamptz not null default now()
);

-- inspection_records
create table if not exists public.inspection_records (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.inspection_tasks(id) on delete cascade,
  device_type text not null,
  entries jsonb not null default '[]'::jsonb,
  report_photos jsonb,
  status text not null default 'draft',
  submitted_at timestamptz,
  approved_at timestamptz,
  approved_by uuid references public.users(id),
  reject_reason jsonb,
  audit_trail jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_tasks_site on public.inspection_tasks(site_id);
create index if not exists idx_tasks_inspector on public.inspection_tasks(inspector_id);
create index if not exists idx_records_task on public.inspection_records(task_id);
create index if not exists idx_members_user on public.site_members(user_id);

-- API 走 Edge Function + service role；关闭 anon 直连写表（前端经 API）
alter table public.users enable row level security;
alter table public.sites enable row level security;
alter table public.site_members enable row level security;
alter table public.devices enable row level security;
alter table public.inspection_templates enable row level security;
alter table public.inspection_tasks enable row level security;
alter table public.inspection_records enable row level security;
