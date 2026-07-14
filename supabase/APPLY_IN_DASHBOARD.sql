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

-- 演示数据（密码均为 bcrypt）
-- admin / admin123
-- xcy002 / 123456

insert into public.users (id, username, password, real_name, phone, role, roles, status)
values
  (
    '11111111-1111-1111-1111-111111111111',
    'admin',
    '$2a$10$5zqOfIY.dxOtmX3IDG619OftNCPFYOs1C7xy7KwkAtMOoq0cICSJS',
    '超级管理员',
    '13800000000',
    'super_admin',
    '["super_admin"]'::jsonb,
    'active'
  ),
  (
    '22222222-2222-2222-2222-222222222222',
    'xcy002',
    '$2a$10$fyuMt/9yRFyX25Ebkfb82ei/OtSATmNGkscnE222/dDiU.tE6P/ZK',
    '巡检员002',
    '13800000002',
    'inspector',
    '["inspector"]'::jsonb,
    'active'
  )
on conflict (username) do nothing;

insert into public.sites (id, name, code, province, city, district, address, latitude, longitude, manager_id, status)
values
  (
    '33333333-3333-3333-3333-333333333333',
    '深圳南山示范站',
    'SZ-NS-001',
    '广东省',
    '深圳市',
    '南山区',
    '科技园示范路 1 号',
    22.5405030,
    113.9345280,
    '11111111-1111-1111-1111-111111111111',
    'active'
  ),
  (
    '44444444-4444-4444-4444-444444444444',
    '广州番禺储能站',
    'GZ-PY-001',
    '广东省',
    '广州市',
    '番禺区',
    '大学城储能路 8 号',
    23.0567800,
    113.3889200,
    '11111111-1111-1111-1111-111111111111',
    'active'
  )
on conflict (code) do nothing;

insert into public.site_members (site_id, user_id, member_role, status)
values
  ('33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222', 'inspector', 'active'),
  ('44444444-4444-4444-4444-444444444444', '22222222-2222-2222-2222-222222222222', 'inspector', 'active')
on conflict (site_id, user_id) do nothing;

insert into public.devices (id, site_id, serial_number, device_type, model, status)
values
  (
    '55555555-5555-5555-5555-555555555551',
    '33333333-3333-3333-3333-333333333333',
    'SN-STRING-001',
    'string_inverter',
    'SG110CX',
    'active'
  ),
  (
    '55555555-5555-5555-5555-555555555552',
    '44444444-4444-4444-4444-444444444444',
    'SN-ESS-001',
    'energy_storage',
    'ESS-200',
    'active'
  )
on conflict (serial_number) do nothing;

insert into public.inspection_templates (id, name, device_type, entries, is_global, site_id, version)
select
  '66666666-6666-6666-6666-666666666661',
  '组串式逆变器巡检',
  'string_inverter',
  '[
    {"id":"e1","name":"上传阳光云截图","description":"必检。请上传阳光云页面截图。","isRequired":true,"order":1,"samplePhotos":[],"checkType":"photo"},
    {"id":"e2","name":"上传故障记录","description":"必检。上传故障/告警截图。","isRequired":true,"order":2,"samplePhotos":[],"checkType":"photo"},
    {"id":"e3","name":"安装固定检查","description":"必检。检查安装是否牢固。","isRequired":true,"order":3,"samplePhotos":[],"checkType":"photo"}
  ]'::jsonb,
  true,
  null,
  1
where not exists (
  select 1 from public.inspection_templates t
  where t.device_type = 'string_inverter' and t.is_global and t.site_id is null
);

insert into public.inspection_templates (id, name, device_type, entries, is_global, site_id, version)
select
  '66666666-6666-6666-6666-666666666662',
  '储能系统巡检',
  'energy_storage',
  '[
    {"id":"e1","name":"箱体检查","description":"必检。检查箱体外观。","isRequired":true,"order":1,"samplePhotos":[],"checkType":"photo"},
    {"id":"e2","name":"电池箱检查","description":"必检。检查电池箱状态。","isRequired":true,"order":2,"samplePhotos":[],"checkType":"photo"},
    {"id":"e3","name":"PCS 检查","description":"必检。检查 PCS 运行状态。","isRequired":true,"order":3,"samplePhotos":[],"checkType":"photo"}
  ]'::jsonb,
  true,
  null,
  1
where not exists (
  select 1 from public.inspection_templates t
  where t.device_type = 'energy_storage' and t.is_global and t.site_id is null
);

