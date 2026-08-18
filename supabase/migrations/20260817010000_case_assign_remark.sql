-- 案例派单备注（网格长填写，PC/H5 展示）
ALTER TABLE service_case
  ADD COLUMN IF NOT EXISTS assign_remark text NULL;
