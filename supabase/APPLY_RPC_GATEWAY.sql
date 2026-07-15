-- ============================================================
-- 无需 Edge Function：用 RPC 网关（Security Definer）+ 匿名会话
-- 在 SQL Editor 整段执行即可
-- ============================================================

create extension if not exists pgcrypto;

create table if not exists public.api_sessions (
  token text primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  role text not null,
  client text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_api_sessions_user on public.api_sessions(user_id);

alter table public.api_sessions enable row level security;

-- 允许匿名调用 RPC（函数本身是 security definer）
grant usage on schema public to anon, authenticated;

create or replace function public._new_token()
returns text
language sql
as $$
  select encode(gen_random_bytes(32), 'hex');
$$;

create or replace function public.app_health()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object('ok', true, 'service', 'supabase-rpc-api', 'storage', 'qiniu', 'llm', 'deepseek');
$$;

create or replace function public.app_login(p_username text, p_password text, p_client text default 'h5')
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  u public.users%rowtype;
  roles text[];
  active_role text;
  access_token text;
  refresh_token text;
  memberships jsonb;
begin
  select * into u from public.users where username = trim(p_username);
  if not found then
    raise exception '用户名或密码错误' using errcode = '28000';
  end if;
  if u.status <> 'active' then
    raise exception '账号已停用，请联系管理员' using errcode = '28000';
  end if;
  if u.password is distinct from extensions.crypt(p_password, u.password) then
    raise exception '用户名或密码错误' using errcode = '28000';
  end if;

  roles := array(select jsonb_array_elements_text(coalesce(u.roles, '[]'::jsonb)));
  if coalesce(array_length(roles, 1), 0) = 0 and u.role is not null then
    roles := array[u.role];
  end if;

  if coalesce(p_client, 'h5') = 'pc' then
    if 'super_admin' = any(roles) then
      active_role := 'super_admin';
    elsif 'site_manager' = any(roles) then
      active_role := 'site_manager';
    elsif exists(select 1 from public.sites s where s.manager_id = u.id) then
      active_role := 'site_manager';
    else
      raise exception '该账号无管理端权限。请使用 H5 巡检端登录' using errcode = '42501';
    end if;
  else
    if 'inspector' = any(roles) then
      active_role := 'inspector';
    elsif exists(select 1 from public.site_members m where m.user_id = u.id and m.status = 'active') then
      active_role := 'inspector';
    else
      raise exception '该账号无巡检端权限。请使用 PC 管理端登录' using errcode = '42501';
    end if;
  end if;

  access_token := public._new_token();
  refresh_token := public._new_token();
  insert into public.api_sessions(token, user_id, role, client, expires_at)
  values
    (access_token, u.id, active_role, coalesce(p_client, 'h5'), now() + interval '2 hours'),
    (refresh_token, u.id, active_role, coalesce(p_client, 'h5'), now() + interval '7 days');

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id,
    'siteId', m.site_id,
    'status', m.status,
    'site', jsonb_build_object(
      'id', s.id,
      'name', s.name,
      'code', s.code,
      'province', s.province,
      'city', s.city
    )
  )), '[]'::jsonb)
  into memberships
  from public.site_members m
  join public.sites s on s.id = m.site_id
  where m.user_id = u.id and m.status = 'active';

  return jsonb_build_object(
    'accessToken', access_token,
    'refreshToken', refresh_token,
    'user', jsonb_build_object(
      'id', u.id,
      'username', u.username,
      'realName', u.real_name,
      'phone', u.phone,
      'email', u.email,
      'avatar', u.avatar,
      'role', active_role,
      'roles', u.roles,
      'status', u.status,
      'region', u.region,
      'siteMemberships', memberships
    )
  );
end;
$$;

create or replace function public._session(p_token text)
returns public.api_sessions
language plpgsql
security definer
set search_path = public
as $$
declare s public.api_sessions%rowtype;
begin
  select * into s from public.api_sessions where token = p_token and expires_at > now();
  if not found then
    raise exception '未登录或登录已过期' using errcode = '28000';
  end if;
  return s;
end;
$$;

create or replace function public.app_me(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.api_sessions%rowtype;
  u public.users%rowtype;
  memberships jsonb;
begin
  s := public._session(p_token);
  select * into u from public.users where id = s.user_id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id,
    'siteId', m.site_id,
    'status', m.status,
    'site', jsonb_build_object(
      'id', sit.id,
      'name', sit.name,
      'code', sit.code,
      'province', sit.province,
      'city', sit.city
    )
  )), '[]'::jsonb)
  into memberships
  from public.site_members m
  join public.sites sit on sit.id = m.site_id
  where m.user_id = u.id and m.status = 'active';

  return jsonb_build_object(
    'id', u.id,
    'username', u.username,
    'realName', u.real_name,
    'phone', u.phone,
    'email', u.email,
    'avatar', u.avatar,
    'role', s.role,
    'roles', u.roles,
    'status', u.status,
    'region', u.region,
    'siteMemberships', memberships
  );
end;
$$;

create or replace function public.app_sites_list(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.api_sessions%rowtype;
  list jsonb;
begin
  s := public._session(p_token);
  if s.role in ('super_admin', 'site_manager') then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', t.id, 'name', t.name, 'code', t.code, 'province', t.province, 'city', t.city,
      'district', t.district, 'address', t.address, 'status', t.status
    ) order by t.created_at desc), '[]'::jsonb)
    into list from public.sites t where t.deleted_at is null;
  else
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', t.id, 'name', t.name, 'code', t.code, 'province', t.province, 'city', t.city,
      'district', t.district, 'address', t.address, 'status', t.status
    )), '[]'::jsonb)
    into list
    from public.site_members m
    join public.sites t on t.id = m.site_id
    where m.user_id = s.user_id and m.status = 'active';
  end if;
  return jsonb_build_object('list', list, 'total', jsonb_array_length(list));
end;
$$;

create or replace function public.app_devices_list(p_token text, p_site_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.api_sessions%rowtype;
  list jsonb;
begin
  s := public._session(p_token);
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', d.id,
    'siteId', d.site_id,
    'serialNumber', d.serial_number,
    'deviceType', d.device_type,
    'model', d.model,
    'status', d.status
  ) order by d.created_at desc), '[]'::jsonb)
  into list
  from public.devices d
  where (p_site_id is null or d.site_id = p_site_id);
  return jsonb_build_object('list', list, 'total', jsonb_array_length(list));
end;
$$;

create or replace function public.app_tasks_list(
  p_token text,
  p_page int default 1,
  p_limit int default 20,
  p_site_id uuid default null,
  p_status text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.api_sessions%rowtype;
  list jsonb;
  total int;
  page_from int;
begin
  s := public._session(p_token);
  page_from := greatest(coalesce(p_page, 1) - 1, 0) * least(coalesce(p_limit, 20), 100);

  select count(*) into total
  from public.inspection_tasks t
  where (s.role <> 'inspector' or t.inspector_id = s.user_id)
    and (p_site_id is null or t.site_id = p_site_id)
    and (p_status is null or t.status = p_status);

  select coalesce(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb)
  into list
  from (
    select
      t.id,
      t.site_id as "siteId",
      t.device_id as "deviceId",
      t.task_name as "taskName",
      t.inspector_id as "inspectorId",
      t.status,
      t.ai_enabled as "aiEnabled",
      t.template_snapshot as "templateSnapshot",
      t.created_at as "createdAt",
      jsonb_build_object('id', site.id, 'name', site.name, 'code', site.code, 'province', site.province, 'city', site.city) as site,
      jsonb_build_object('id', dev.id, 'serialNumber', dev.serial_number, 'deviceType', dev.device_type, 'model', dev.model) as device,
      jsonb_build_object('id', insp.id, 'realName', insp.real_name) as inspector
    from public.inspection_tasks t
    left join public.sites site on site.id = t.site_id
    left join public.devices dev on dev.id = t.device_id
    left join public.users insp on insp.id = t.inspector_id
    where (s.role <> 'inspector' or t.inspector_id = s.user_id)
      and (p_site_id is null or t.site_id = p_site_id)
      and (p_status is null or t.status = p_status)
    order by t.created_at desc
    offset page_from
    limit least(coalesce(p_limit, 20), 100)
  ) x;

  return jsonb_build_object('list', list, 'total', total, 'page', coalesce(p_page, 1), 'limit', coalesce(p_limit, 20));
end;
$$;

create or replace function public.app_task_get(p_token text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.api_sessions%rowtype;
  result jsonb;
  rec jsonb;
begin
  s := public._session(p_token);
  select jsonb_build_object(
    'id', t.id,
    'siteId', t.site_id,
    'deviceId', t.device_id,
    'taskName', t.task_name,
    'inspectorId', t.inspector_id,
    'status', t.status,
    'aiEnabled', t.ai_enabled,
    'templateSnapshot', t.template_snapshot,
    'createdAt', t.created_at,
    'site', jsonb_build_object('id', site.id, 'name', site.name, 'code', site.code, 'province', site.province, 'city', site.city),
    'device', jsonb_build_object('id', dev.id, 'serialNumber', dev.serial_number, 'deviceType', dev.device_type, 'model', dev.model),
    'inspector', jsonb_build_object('id', insp.id, 'realName', insp.real_name)
  )
  into result
  from public.inspection_tasks t
  left join public.sites site on site.id = t.site_id
  left join public.devices dev on dev.id = t.device_id
  left join public.users insp on insp.id = t.inspector_id
  where t.id = p_id
    and (s.role <> 'inspector' or t.inspector_id = s.user_id);

  if result is null then
    raise exception '任务不存在' using errcode = '02000';
  end if;

  select jsonb_build_object(
    'id', r.id,
    'status', r.status,
    'entries', r.entries,
    'rejectReason', r.reject_reason
  )
  into rec
  from public.inspection_records r
  where r.task_id = p_id
  limit 1;

  result := result || jsonb_build_object('record', rec);
  return result;
end;
$$;

create or replace function public.app_task_create(p_token text, p_body jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.api_sessions%rowtype;
  v_device_id uuid;
  v_site_id uuid;
  v_task_name text;
  v_inspector_id uuid;
  v_device_type text;
  v_tpl jsonb;
  new_id uuid;
  result jsonb;
begin
  s := public._session(p_token);
  v_device_id := (p_body->>'deviceId')::uuid;
  v_site_id := nullif(p_body->>'siteId', '')::uuid;
  v_task_name := coalesce(nullif(p_body->>'taskName', ''), '巡检任务');
  v_inspector_id := coalesce(nullif(p_body->>'inspectorId', '')::uuid, s.user_id);

  select d.site_id, d.device_type into v_site_id, v_device_type
  from public.devices d where d.id = v_device_id;
  if v_device_type is null then
    raise exception '设备不存在' using errcode = '02000';
  end if;
  v_site_id := coalesce(nullif(p_body->>'siteId', '')::uuid, v_site_id);

  select t.entries into v_tpl
  from public.inspection_templates t
  where t.device_type = v_device_type and t.is_global = true and t.site_id is null
  order by t.version desc
  limit 1;

  insert into public.inspection_tasks(
    site_id, device_id, task_name, inspector_id, created_by, status, ai_enabled, template_snapshot
  ) values (
    v_site_id, v_device_id, v_task_name, v_inspector_id, s.user_id, 'pending',
    coalesce((p_body->>'aiEnabled')::boolean, true),
    coalesce(v_tpl, '[]'::jsonb)
  ) returning id into new_id;

  return public.app_task_get(p_token, new_id);
end;
$$;

grant execute on function public.app_health() to anon, authenticated;
grant execute on function public.app_login(text, text, text) to anon, authenticated;
grant execute on function public.app_me(text) to anon, authenticated;
grant execute on function public.app_sites_list(text) to anon, authenticated;
grant execute on function public.app_devices_list(text, uuid) to anon, authenticated;
grant execute on function public.app_tasks_list(text, int, int, uuid, text) to anon, authenticated;
grant execute on function public.app_task_get(text, uuid) to anon, authenticated;
grant execute on function public.app_task_create(text, jsonb) to anon, authenticated;

-- 内部辅助函数只能由函数所有者调用，避免匿名端直接创建/读取会话。
revoke all on function public._new_token() from public, anon, authenticated;
revoke all on function public._session(text) from public, anon, authenticated;

-- 密码改为 Postgres crypt，保证 RPC 校验与 bcryptjs 种子兼容
update public.users
set password = extensions.crypt('admin123', extensions.gen_salt('bf'))
where username = 'admin';

update public.users
set password = extensions.crypt('123456', extensions.gen_salt('bf'))
where username = 'xcy002';

select 'rpc_ready' as status;
