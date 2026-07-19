-- 费用结算中心迭代 1 回滚。执行前请先备份业务数据。
drop table if exists public.item_price_mapping;
drop table if exists public.change_log;
drop table if exists public.case_performance;
drop table if exists public.po_item;
drop table if exists public.price_library;
drop table if exists public.po_order;
drop table if exists public.service_case;
drop table if exists public.import_batch;
alter table public.users drop column if exists org_unit;
-- region 在本项目原表中已存在，回滚时保留。
