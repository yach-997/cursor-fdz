begin;
drop index if exists public.idx_case_performance_review;
drop index if exists public.idx_service_case_inspector_status;
alter table public.case_performance
  drop column if exists deduction_review_time,
  drop column if exists deduction_review_by,
  drop column if exists deduction_status;
drop table if exists public.case_work_record;
commit;
