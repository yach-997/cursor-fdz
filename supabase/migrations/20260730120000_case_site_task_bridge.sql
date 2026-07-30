-- 案例挂站点 + 任务类型；巡检任务挂案例（1:1）
ALTER TABLE service_case
  ADD COLUMN IF NOT EXISTS site_id uuid NULL REFERENCES sites(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS task_type varchar(32) NULL;

CREATE INDEX IF NOT EXISTS idx_service_case_site_id ON service_case(site_id);
CREATE INDEX IF NOT EXISTS idx_service_case_task_type ON service_case(task_type);

ALTER TABLE inspection_tasks
  ADD COLUMN IF NOT EXISTS service_case_id bigint NULL REFERENCES service_case(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS task_type varchar(32) NOT NULL DEFAULT 'inspection';

-- 未派工程师时可为空（站点先建任务后派单）
ALTER TABLE inspection_tasks ALTER COLUMN inspector_id DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_inspection_tasks_service_case_id
  ON inspection_tasks(service_case_id)
  WHERE service_case_id IS NOT NULL;

COMMENT ON COLUMN service_case.site_id IS '归属站点；管理员分配后站点可见';
COMMENT ON COLUMN service_case.task_type IS 'inspection=巡检 service=服务作业';
COMMENT ON COLUMN inspection_tasks.service_case_id IS '关联费用案例（一对一）';
COMMENT ON COLUMN inspection_tasks.task_type IS '任务类型，默认巡检';
