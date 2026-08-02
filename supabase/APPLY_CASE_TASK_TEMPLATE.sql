-- 在 Supabase SQL Editor 执行本文件
-- 案例「任务类型」关联到「任务类型设置」（原模板配置）

ALTER TABLE service_case
  ADD COLUMN IF NOT EXISTS task_template_id uuid NULL REFERENCES inspection_templates(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_service_case_task_template_id ON service_case(task_template_id);

ALTER TABLE service_case
  ALTER COLUMN task_type TYPE varchar(128);
