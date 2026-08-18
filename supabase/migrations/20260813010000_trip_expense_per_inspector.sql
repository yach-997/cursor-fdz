-- 行程报销：由「一台一单」改为「一案例一工程师一单」
-- 先合并重复，再换唯一约束

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY service_case_id, inspector_id
      ORDER BY
        CASE
          WHEN COALESCE(start_odometer_url, '') <> '' THEN 0
          WHEN trip_skipped THEN 2
          ELSE 1
        END,
        updated_at DESC NULLS LAST,
        created_at DESC NULLS LAST,
        id DESC
    ) AS rn
  FROM case_expense_claim
)
DELETE FROM case_expense_claim c
USING ranked r
WHERE c.id = r.id AND r.rn > 1;

DROP INDEX IF EXISTS uq_case_expense_work_unit;

CREATE UNIQUE INDEX IF NOT EXISTS uq_case_expense_case_inspector
  ON case_expense_claim (service_case_id, inspector_id);
