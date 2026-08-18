-- 费用明细：一条报销单内可多条（行程 / 过路费 / 其他）
ALTER TABLE case_expense_claim
  ADD COLUMN IF NOT EXISTS line_items jsonb NOT NULL DEFAULT '[]'::jsonb;
