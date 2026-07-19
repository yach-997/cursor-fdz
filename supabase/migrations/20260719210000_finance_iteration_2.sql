begin;

create table if not exists public.case_work_record (
  id bigserial primary key,
  service_case_id bigint not null unique references public.service_case(id) on delete cascade,
  gsp_case_no varchar(32) not null unique,
  inspector_id uuid not null references public.users(id),
  workload jsonb not null default '{}'::jsonb,
  mileage numeric(12,2) not null default 0,
  expenses numeric(12,2) not null default 0,
  expense_note text,
  mileage_screenshot_urls jsonb not null default '[]'::jsonb,
  work_note text,
  accepted_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_case_work_record_inspector
  on public.case_work_record(inspector_id, updated_at desc);

alter table public.case_performance
  add column if not exists deduction_status varchar(16) not null default 'none',
  add column if not exists deduction_review_by uuid references public.users(id),
  add column if not exists deduction_review_time timestamptz;

create index if not exists idx_service_case_inspector_status
  on public.service_case(inspector_id, status);
create index if not exists idx_case_performance_review
  on public.case_performance(review_status, month);

alter table public.case_work_record enable row level security;

commit;
