-- Allow perf_price import batches
alter table public.import_batch
  drop constraint if exists import_batch_import_type_check;

alter table public.import_batch
  add constraint import_batch_import_type_check
  check (import_type in ('gsp_case', 'po_order', 'settle_price', 'perf_price'));
