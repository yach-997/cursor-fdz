-- 内部绩效价 Excel 导入：扩展 import_batch.import_type 允许 perf_price
-- 在 Supabase Dashboard → SQL Editor 中整段执行（可重复执行）

begin;

alter table public.import_batch
  drop constraint if exists import_batch_import_type_check;

alter table public.import_batch
  add constraint import_batch_import_type_check
  check (import_type in ('gsp_case', 'po_order', 'settle_price', 'perf_price'));

commit;

-- 验证：
-- select conname, pg_get_constraintdef(oid)
-- from pg_constraint
-- where conrelid = 'public.import_batch'::regclass and contype = 'c';
