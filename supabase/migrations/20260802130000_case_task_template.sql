-- 案例任务类型关联巡检/作业模板（任务类型设置）
ALTER TABLE service_case
  ADD COLUMN IF NOT EXISTS task_template_id uuid NULL REFERENCES inspection_templates(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_service_case_task_template_id ON service_case(task_template_id);

-- 任务类型名称可能较长，放宽 task_type 展示字段
ALTER TABLE service_case
  ALTER COLUMN task_type TYPE varchar(128);
