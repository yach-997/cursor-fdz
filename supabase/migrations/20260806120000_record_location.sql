-- 巡检报告现场定位留痕（取消围栏后写入经纬度）
ALTER TABLE inspection_records
  ADD COLUMN IF NOT EXISTS location jsonb NULL;
