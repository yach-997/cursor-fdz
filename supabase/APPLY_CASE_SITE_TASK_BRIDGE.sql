-- 在 Supabase SQL Editor 执行本文件（案例-站点-任务桥接）
-- 来源：migrations/20260730120000_case_site_task_bridge.sql

ALTER TABLE service_case
  ADD COLUMN IF NOT EXISTS site_id uuid NULL REFERENCES sites(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS task_type varchar(32) NULL;

CREATE INDEX IF NOT EXISTS idx_service_case_site_id ON service_case(site_id);
CREATE INDEX IF NOT EXISTS idx_service_case_task_type ON service_case(task_type);

ALTER TABLE inspection_tasks
  ADD COLUMN IF NOT EXISTS service_case_id bigint NULL REFERENCES service_case(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS task_type varchar(32) NOT NULL DEFAULT 'inspection';

ALTER TABLE inspection_tasks ALTER COLUMN inspector_id DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_inspection_tasks_service_case_id
  ON inspection_tasks(service_case_id)
  WHERE service_case_id IS NOT NULL;
