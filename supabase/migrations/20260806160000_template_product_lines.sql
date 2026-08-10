-- 服务类型产品线 + 案例产品线
ALTER TABLE inspection_templates
  ADD COLUMN IF NOT EXISTS product_lines jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE service_case
  ADD COLUMN IF NOT EXISTS product_line varchar(64) NULL;
