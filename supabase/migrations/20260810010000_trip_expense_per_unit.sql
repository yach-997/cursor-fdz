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
  ADD COLUMN IF NOT EXISTS mileage_km numeric(12, 1) NULL;

ALTER TABLE case_expense_claim
  ADD COLUMN IF NOT EXISTS claim_amount numeric(12, 2) NOT NULL DEFAULT 0;
ALTER TABLE case_expense_claim
  ADD COLUMN IF NOT EXISTS trip_skipped boolean NOT NULL DEFAULT false;
UPDATE case_expense_claim SET claim_amount = amount WHERE claim_amount = 0 AND amount > 0;

CREATE UNIQUE INDEX IF NOT EXISTS uq_case_expense_work_unit
  ON case_expense_claim (work_unit_id)
  WHERE work_unit_id IS NOT NULL;
