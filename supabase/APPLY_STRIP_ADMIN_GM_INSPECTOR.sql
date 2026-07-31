-- 在 Supabase SQL Editor 执行：清理「管理员设立的正网格长」上的历史工程师兼岗
-- 执行后这些账号只能登 PC，不能再登 H5

update public.users u
set
  role = 'site_manager',
  roles = '["site_manager"]'::jsonb
where u.created_by in (select id from public.users where role = 'super_admin')
  and (
    u.role = 'inspector'
    or coalesce(u.roles, '[]'::jsonb) ? 'inspector'
  );
