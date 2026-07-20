-- 价格库条目编码过长会导致导入 500（综合工时编码含型号/项目上下文）
-- 在 Supabase SQL Editor 执行一次即可

alter table public.price_library
  alter column item_code type text,
  alter column item_name type text;
