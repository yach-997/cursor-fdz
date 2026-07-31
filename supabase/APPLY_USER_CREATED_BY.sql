-- 在 Supabase SQL Editor 执行：为 users 增加 created_by，并尽量回填历史账号
-- 与 migrations/20260731010000_user_created_by.sql 等价

alter table public.users
  add column if not exists created_by uuid references public.users(id) on delete set null;

create index if not exists idx_users_created_by on public.users(created_by);

-- 历史网格长：挂到任意一名超级管理员名下（便于管理员继续管理）
update public.users u
set created_by = a.id
from public.users a
where u.created_by is null
  and a.role = 'super_admin'
  and a.status = 'active'
  and (
    u.role = 'site_manager'
    or coalesce(u.roles, '[]'::jsonb) ? 'site_manager'
  )
  and u.role <> 'super_admin'
  and not (coalesce(u.roles, '[]'::jsonb) ? 'super_admin');

-- 管理员创建的正网格长：去掉历史工程师兼岗（不能再登 H5）
update public.users u
set
  role = 'site_manager',
  roles = '["site_manager"]'::jsonb
where u.created_by in (select id from public.users where role = 'super_admin')
  and (
    u.role = 'inspector'
    or coalesce(u.roles, '[]'::jsonb) ? 'inspector'
  );
