-- 多人派单 / 执行单元 / 绩效分账 / 报销
-- 兼容存量：回填单人 assignment + 单单元

-- 1) 任务类型扩展
ALTER TABLE inspection_templates
  ADD COLUMN IF NOT EXISTS assign_mode varchar(16) NOT NULL DEFAULT 'single',
  ADD COLUMN IF NOT EXISTS unit_label varchar(32) NOT NULL DEFAULT '站点',
  ADD COLUMN IF NOT EXISTS expense_enabled_default boolean NOT NULL DEFAULT false;

-- 2) 案例扩展
ALTER TABLE service_case
  ADD COLUMN IF NOT EXISTS assign_mode varchar(16) NOT NULL DEFAULT 'single',
  ADD COLUMN IF NOT EXISTS planned_units int NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS completed_units int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS expense_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS unit_label varchar(32) NOT NULL DEFAULT '站点';

-- 3) 派单表
CREATE TABLE IF NOT EXISTS case_assignment (
  id bigserial PRIMARY KEY,
  service_case_id bigint NOT NULL REFERENCES service_case(id) ON DELETE CASCADE,
  inspector_id uuid NOT NULL,
  assign_by uuid NULL,
  assign_time timestamptz NULL,
  status varchar(16) NOT NULL DEFAULT 'assigned',
  completed_units int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (service_case_id, inspector_id)
);
CREATE INDEX IF NOT EXISTS idx_case_assignment_inspector ON case_assignment(inspector_id);
CREATE INDEX IF NOT EXISTS idx_case_assignment_case ON case_assignment(service_case_id);

-- 4) 执行单元
CREATE TABLE IF NOT EXISTS case_work_unit (
  id bigserial PRIMARY KEY,
  service_case_id bigint NOT NULL REFERENCES service_case(id) ON DELETE CASCADE,
  seq int NOT NULL,
  title varchar(128) NULL,
  status varchar(16) NOT NULL DEFAULT 'open',
  inspector_id uuid NULL,
  inspection_task_id uuid NULL,
  claimed_at timestamptz NULL,
  submitted_at timestamptz NULL,
  completed_at timestamptz NULL,
  submit_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (service_case_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_case_work_unit_case ON case_work_unit(service_case_id);
CREATE INDEX IF NOT EXISTS idx_case_work_unit_inspector ON case_work_unit(inspector_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_case_work_unit_task
  ON case_work_unit(inspection_task_id) WHERE inspection_task_id IS NOT NULL;

-- 5) 巡检任务挂单元；取消「一案例一任务」硬唯一
ALTER TABLE inspection_tasks
  ADD COLUMN IF NOT EXISTS work_unit_id bigint NULL;

DROP INDEX IF EXISTS uq_inspection_tasks_service_case_id;
CREATE UNIQUE INDEX IF NOT EXISTS uq_inspection_tasks_work_unit
  ON inspection_tasks(work_unit_id) WHERE work_unit_id IS NOT NULL;
-- 无单元的历史任务仍可按案例查；允许多任务同案例

-- 6) 绩效分账
CREATE TABLE IF NOT EXISTS case_perf_share (
  id bigserial PRIMARY KEY,
  service_case_id bigint NOT NULL REFERENCES service_case(id) ON DELETE CASCADE,
  inspector_id uuid NOT NULL,
  completed_units int NOT NULL DEFAULT 0,
  share_ratio numeric(8, 6) NOT NULL DEFAULT 0,
  perf_amount numeric(12, 2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (service_case_id, inspector_id)
);
CREATE INDEX IF NOT EXISTS idx_case_perf_share_inspector ON case_perf_share(inspector_id);

-- 7) 报销单
CREATE TABLE IF NOT EXISTS case_expense_claim (
  id bigserial PRIMARY KEY,
  service_case_id bigint NOT NULL REFERENCES service_case(id) ON DELETE CASCADE,
  inspector_id uuid NOT NULL,
  amount numeric(12, 2) NOT NULL DEFAULT 0,
  note text NULL,
  voucher_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  status varchar(16) NOT NULL DEFAULT 'draft',
  review_by uuid NULL,
  review_at timestamptz NULL,
  review_note text NULL,
  month varchar(7) NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_case_expense_case ON case_expense_claim(service_case_id);
CREATE INDEX IF NOT EXISTS idx_case_expense_inspector ON case_expense_claim(inspector_id);
CREATE INDEX IF NOT EXISTS idx_case_expense_status ON case_expense_claim(status);

-- 8) 月结增加报销合计
ALTER TABLE monthly_settlement
  ADD COLUMN IF NOT EXISTS expense_total numeric(12, 2) NOT NULL DEFAULT 0;

-- 9) 存量回填：派单
INSERT INTO case_assignment (service_case_id, inspector_id, assign_by, assign_time, status, completed_units)
SELECT
  sc.id,
  sc.inspector_id,
  sc.assign_by,
  sc.assign_time,
  CASE
    WHEN sc.status IN ('finished', 'settle_review', 'settled', 'month_locked') THEN 'done'
    WHEN sc.status = 'working' THEN 'working'
    ELSE 'assigned'
  END,
  CASE
    WHEN sc.status IN ('finished', 'settle_review', 'settled', 'month_locked') THEN 1
    ELSE 0
  END
FROM service_case sc
WHERE sc.inspector_id IS NOT NULL
ON CONFLICT (service_case_id, inspector_id) DO NOTHING;

-- 10) 存量回填：执行单元（每案 1 个）
INSERT INTO case_work_unit (
  service_case_id, seq, title, status, inspector_id, inspection_task_id,
  claimed_at, submitted_at, completed_at, submit_count
)
SELECT
  sc.id,
  1,
  COALESCE(sc.unit_label, '站点') || ' #1',
  CASE
    WHEN sc.status IN ('finished', 'settle_review', 'settled', 'month_locked') THEN 'completed'
    WHEN t.status IN ('submitted', 'approved') THEN 'submitted'
    WHEN sc.inspector_id IS NOT NULL THEN 'claimed'
    ELSE 'open'
  END,
  sc.inspector_id,
  t.id,
  sc.assign_time,
  CASE WHEN t.status IN ('submitted', 'approved') THEN COALESCE(t.completed_at, sc.finish_time) END,
  CASE
    WHEN sc.status IN ('finished', 'settle_review', 'settled', 'month_locked')
    THEN sc.finish_time
  END,
  CASE WHEN t.status IN ('submitted', 'approved') THEN 1 ELSE 0 END
FROM service_case sc
LEFT JOIN LATERAL (
  SELECT it.* FROM inspection_tasks it
  WHERE it.service_case_id = sc.id
  ORDER BY it.created_at ASC
  LIMIT 1
) t ON true
WHERE NOT EXISTS (
  SELECT 1 FROM case_work_unit u WHERE u.service_case_id = sc.id
);

UPDATE inspection_tasks it
SET work_unit_id = u.id
FROM case_work_unit u
WHERE u.inspection_task_id = it.id
  AND it.work_unit_id IS NULL;

UPDATE service_case sc
SET completed_units = CASE
  WHEN sc.status IN ('finished', 'settle_review', 'settled', 'month_locked') THEN GREATEST(sc.planned_units, 1)
  ELSE sc.completed_units
END;

-- 11) 存量分账：全额给原工程师
INSERT INTO case_perf_share (service_case_id, inspector_id, completed_units, share_ratio, perf_amount)
SELECT
  cp.service_case_id,
  cp.inspector_id,
  1,
  1,
  cp.perf_final
FROM case_performance cp
WHERE cp.inspector_id IS NOT NULL
ON CONFLICT (service_case_id, inspector_id) DO NOTHING;
