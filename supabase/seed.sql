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
