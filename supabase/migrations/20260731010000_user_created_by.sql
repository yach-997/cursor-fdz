-- 用户创建人隔离：管理员只看自己设立的正网格长；正网格长只看自己设立的副网格长/工程师
alter table public.users
  add column if not exists created_by uuid references public.users(id) on delete set null;

create index if not exists idx_users_created_by on public.users(created_by);

comment on column public.users.created_by is '账号创建人：管理员创建正网格长；正网格长创建副网格长与工程师';
