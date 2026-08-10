import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';

/**
 * 幂等补齐多人派单/单元/分账/报销表结构（Preview/Serverless 无本地 migrate 时依赖此引导）。
 */
@Injectable()
export class MultiSchemaBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(MultiSchemaBootstrapService.name);

  constructor(private readonly dataSource: DataSource) {}

  async onModuleInit() {
    try {
      await this.ensureSystemBranding();
      await this.dataSource.query(`
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS employee_no varchar(32) NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_employee_no
  ON users (employee_no)
  WHERE employee_no IS NOT NULL AND TRIM(employee_no) <> '';

ALTER TABLE inspection_records
  ADD COLUMN IF NOT EXISTS location jsonb NULL;

ALTER TABLE inspection_templates
  ADD COLUMN IF NOT EXISTS assign_mode varchar(16) NOT NULL DEFAULT 'single',
  ADD COLUMN IF NOT EXISTS unit_label varchar(32) NOT NULL DEFAULT '台',
  ADD COLUMN IF NOT EXISTS expense_enabled_default boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS product_lines jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE service_case
  ADD COLUMN IF NOT EXISTS assign_mode varchar(16) NOT NULL DEFAULT 'single',
  ADD COLUMN IF NOT EXISTS planned_units int NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS completed_units int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS expense_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS unit_label varchar(32) NOT NULL DEFAULT '台',
  ADD COLUMN IF NOT EXISTS product_line varchar(64) NULL;

-- 业务统一用「台」
UPDATE inspection_templates SET unit_label = '台' WHERE unit_label IS DISTINCT FROM '台';
UPDATE service_case SET unit_label = '台' WHERE unit_label IS DISTINCT FROM '台';

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

ALTER TABLE inspection_tasks ADD COLUMN IF NOT EXISTS work_unit_id bigint NULL;
DROP INDEX IF EXISTS uq_inspection_tasks_service_case_id;
CREATE UNIQUE INDEX IF NOT EXISTS uq_inspection_tasks_work_unit
  ON inspection_tasks(work_unit_id) WHERE work_unit_id IS NOT NULL;

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

ALTER TABLE monthly_settlement
  ADD COLUMN IF NOT EXISTS expense_total numeric(12, 2) NOT NULL DEFAULT 0;

-- 行程报销：按台 + 起止里程 + 分项费用
ALTER TABLE case_expense_claim
  ADD COLUMN IF NOT EXISTS work_unit_id bigint NULL REFERENCES case_work_unit(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS toll_amount numeric(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fuel_amount numeric(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS other_amount numeric(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS toll_voucher_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS fuel_voucher_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS other_voucher_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS start_odometer_url text NULL,
  ADD COLUMN IF NOT EXISTS start_nav_url text NULL,
  ADD COLUMN IF NOT EXISTS start_mileage numeric(12, 1) NULL,
  ADD COLUMN IF NOT EXISTS end_odometer_url text NULL,
  ADD COLUMN IF NOT EXISTS end_nav_url text NULL,
  ADD COLUMN IF NOT EXISTS end_mileage numeric(12, 1) NULL,
  ADD COLUMN IF NOT EXISTS mileage_km numeric(12, 1) NULL,
  ADD COLUMN IF NOT EXISTS claim_amount numeric(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS trip_skipped boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS start_nav_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS end_nav_urls jsonb NOT NULL DEFAULT '[]'::jsonb;
UPDATE case_expense_claim SET claim_amount = amount WHERE claim_amount = 0 AND amount > 0;
UPDATE case_expense_claim
SET start_nav_urls = jsonb_build_array(start_nav_url)
WHERE start_nav_url IS NOT NULL
  AND start_nav_url <> ''
  AND (start_nav_urls IS NULL OR start_nav_urls = '[]'::jsonb);
UPDATE case_expense_claim
SET end_nav_urls = jsonb_build_array(end_nav_url)
WHERE end_nav_url IS NOT NULL
  AND end_nav_url <> ''
  AND (end_nav_urls IS NULL OR end_nav_urls = '[]'::jsonb);
CREATE UNIQUE INDEX IF NOT EXISTS uq_case_expense_work_unit
  ON case_expense_claim (work_unit_id)
  WHERE work_unit_id IS NOT NULL;
`);

      // 轻量回填：有 inspector 但无 assignment 的案例
      await this.dataSource.query(`
INSERT INTO case_assignment (service_case_id, inspector_id, assign_by, assign_time, status, completed_units)
SELECT sc.id, sc.inspector_id, sc.assign_by, sc.assign_time,
  CASE WHEN sc.status IN ('finished','settle_review','settled','month_locked') THEN 'done'
       WHEN sc.status = 'working' THEN 'working' ELSE 'assigned' END,
  CASE WHEN sc.status IN ('finished','settle_review','settled','month_locked') THEN 1 ELSE 0 END
FROM service_case sc
WHERE sc.inspector_id IS NOT NULL
ON CONFLICT (service_case_id, inspector_id) DO NOTHING;
`);

      await this.dataSource.query(`
INSERT INTO case_work_unit (service_case_id, seq, title, status, inspector_id, inspection_task_id)
SELECT sc.id, 1, COALESCE(sc.unit_label,'台') || ' #1',
  CASE WHEN sc.status IN ('finished','settle_review','settled','month_locked') THEN 'completed'
       WHEN sc.inspector_id IS NOT NULL THEN 'claimed' ELSE 'open' END,
  sc.inspector_id, t.id
FROM service_case sc
LEFT JOIN LATERAL (
  SELECT it.id FROM inspection_tasks it WHERE it.service_case_id = sc.id ORDER BY it.created_at ASC LIMIT 1
) t ON true
WHERE NOT EXISTS (SELECT 1 FROM case_work_unit u WHERE u.service_case_id = sc.id);
`);

      await this.dedupeTemplateNames();
      await this.seedDemandTypeTemplates();

      this.logger.log('多人派单/报销表结构已就绪');
    } catch (error) {
      this.logger.warn(`多人派单表结构引导失败: ${(error as Error).message}`);
    }
  }

  /** 合并同名服务类型：保留条目更多/版本更高者，案例引用改挂到保留项 */
  private async dedupeTemplateNames() {
    await this.dataSource.query(`
WITH ranked AS (
  SELECT
    id,
    TRIM(name) AS n,
    ROW_NUMBER() OVER (
      PARTITION BY TRIM(name)
      ORDER BY jsonb_array_length(COALESCE(entries, '[]'::jsonb)) DESC,
               COALESCE(version, 1) DESC,
               created_at ASC NULLS LAST,
               id ASC
    ) AS rn
  FROM inspection_templates
),
dups AS (
  SELECT r.id AS dup_id, k.id AS keep_id
  FROM ranked r
  INNER JOIN ranked k ON k.n = r.n AND k.rn = 1
  WHERE r.rn > 1
)
UPDATE service_case sc
SET task_template_id = d.keep_id
FROM dups d
WHERE sc.task_template_id = d.dup_id
`);

    const del = await this.dataSource.query(`
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY TRIM(name)
      ORDER BY jsonb_array_length(COALESCE(entries, '[]'::jsonb)) DESC,
               COALESCE(version, 1) DESC,
               created_at ASC NULLS LAST,
               id ASC
    ) AS rn
  FROM inspection_templates
)
DELETE FROM inspection_templates t
USING ranked r
WHERE t.id = r.id AND r.rn > 1
RETURNING t.id
`);
    const removed = Array.isArray(del) ? del.length : 0;
    if (removed) {
      this.logger.log(`已合并 ${removed} 条重名服务类型`);
    }

    await this.dataSource.query(`
CREATE UNIQUE INDEX IF NOT EXISTS uq_inspection_templates_name_trim
  ON inspection_templates ((TRIM(name)))
`);
  }

  private async ensureSystemBranding() {
    await this.dataSource.query(`
CREATE TABLE IF NOT EXISTS system_branding (
  id varchar(32) PRIMARY KEY DEFAULT 'default',
  system_name varchar(64) NOT NULL DEFAULT '阳光运维系统',
  subtitle varchar(64) NULL DEFAULT '阳光运维平台',
  logo_url text NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO system_branding (id, system_name, subtitle)
VALUES ('default', '阳光运维系统', '阳光运维平台')
ON CONFLICT (id) DO NOTHING;
`);
  }

  /** 幂等写入 PO 对齐的全局需求类型（巡检/故障恢复/整改/维护/交付） */
  private async seedDemandTypeTemplates() {
    const defs: Array<{
      name: string;
      assignMode: 'single' | 'multi';
      unitLabel: string;
    }> = [
      // 派单模式由案例派单时选择，服务类型不再预设多人/多台
      { name: '巡检', assignMode: 'single', unitLabel: '台' },
      { name: '故障恢复', assignMode: 'single', unitLabel: '台' },
      { name: '整改', assignMode: 'single', unitLabel: '台' },
      { name: '维护', assignMode: 'single', unitLabel: '台' },
      { name: '交付', assignMode: 'single', unitLabel: '台' },
    ];

    // 已有任意全局服务类型时不再自动补种。
    // 否则用户把「交付」改名为「交付1」后，下次启动又会冒出空的「交付」。
    const existing = await this.dataSource.query(`
SELECT COUNT(*)::int AS cnt
FROM inspection_templates
WHERE is_global = true AND site_id IS NULL
`);
    const globalCount = Number(existing?.[0]?.cnt || 0);
    let created = 0;
    if (globalCount === 0) {
      for (const def of defs) {
        const entry = {
          id: randomUUID(),
          name: '现场作业记录',
          description:
            '请按该服务类型现场规范完成作业并上传凭证；可在「服务类型」中完善检查条目与样本图。',
          isRequired: true,
          order: 0,
          samplePhotos: [] as string[],
          checkType: 'photo',
          isOptionalModule: false,
        };
        const result = await this.dataSource.query(
          `
INSERT INTO inspection_templates (
  id, name, device_type, entries, is_global, site_id,
  assign_mode, unit_label, expense_enabled_default, version, created_at
)
SELECT gen_random_uuid(), $1, $2, $3::jsonb, true, NULL,
       $4, $5, false, 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM inspection_templates
  WHERE TRIM(name) = TRIM($1)
)
RETURNING id
`,
          [def.name, 'string_inverter', JSON.stringify([entry]), def.assignMode, def.unitLabel],
        );
        if (Array.isArray(result) && result.length) created += 1;
      }
      if (created) {
        this.logger.log(`已初始化 ${created} 个全局需求类型模板`);
      }
    }

    // 历史：巡检/整改曾默认 multi，统一改回 single（派单时再选）
    await this.dataSource.query(`
UPDATE inspection_templates
SET assign_mode = 'single'
WHERE is_global = true
  AND site_id IS NULL
  AND TRIM(name) IN ('巡检', '整改', '故障恢复', '维护', '交付')
  AND assign_mode IS DISTINCT FROM 'single'
`);

    // 尚未派单的案例：不要沿用旧模板的 multi，回到单人默认；台数重置为 1
    await this.dataSource.query(`
UPDATE service_case
SET assign_mode = 'single',
    planned_units = 1
WHERE status = 'pending_assign'
  AND (
    assign_mode IS DISTINCT FROM 'single'
    OR COALESCE(planned_units, 1) <> 1
  )
`);

    // 已有案例：按 service_type 自动挂上同名需求类型（仅未设类型时）；不改派单模式
    await this.dataSource.query(`
UPDATE service_case sc
SET
  task_template_id = t.id,
  task_type = t.name,
  unit_label = '台',
  expense_enabled = COALESCE(t.expense_enabled_default, sc.expense_enabled, false)
FROM inspection_templates t
WHERE sc.task_template_id IS NULL
  AND NULLIF(TRIM(sc.service_type), '') IS NOT NULL
  AND t.name = TRIM(sc.service_type)
  AND t.is_global = true
  AND t.site_id IS NULL
`);
  }
}
