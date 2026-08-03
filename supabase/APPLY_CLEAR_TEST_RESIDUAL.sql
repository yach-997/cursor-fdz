-- =============================================================================
-- 测前清残留：对齐「案例已清空但 H5 本月统计仍有数」的情况
-- 在 Supabase SQL Editor 整段执行
--
-- 会清空：案例/PO/巡检任务与报告/考核月结/预警/案例占位设备/导入批次
-- 保留：用户、站点、入职关系、任务类型模板、价格库
-- =============================================================================

begin;

do $$
declare
  t text;
  tables text[] := array[
    'inspection_records',
    'inspection_tasks',
    'case_work_record',
    'case_performance',
    'assessment_event',
    'assessment',
    'monthly_settlement',
    'po_item',
    'po_order',
    'service_case',
    'alert_records',
    'import_batch',
    'change_log'
  ];
begin
  foreach t in array tables loop
    if to_regclass('public.' || t) is not null then
      execute format('delete from public.%I', t);
    end if;
  end loop;
end $$;

-- 案例派单产生的占位设备（CASE-案例号）
delete from public.devices where serial_number like 'CASE-%';

commit;

-- 核对：下列业务表应为 0；用户/站点/模板/价格应仍有数
select 'service_case' as t, count(*)::int as n from public.service_case
union all select 'po_order', count(*)::int from public.po_order
union all select 'inspection_tasks', count(*)::int from public.inspection_tasks
union all select 'inspection_records', count(*)::int from public.inspection_records
union all select 'devices_case_placeholder', count(*)::int from public.devices where serial_number like 'CASE-%'
union all select 'users', count(*)::int from public.users
union all select 'sites', count(*)::int from public.sites
union all select 'templates', count(*)::int from public.inspection_templates
union all select 'price_library', count(*)::int from public.price_library;
