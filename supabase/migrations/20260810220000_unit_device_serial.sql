-- 作业台设备序列号（拍照识别，可手改）
ALTER TABLE case_work_unit
  ADD COLUMN IF NOT EXISTS device_serial varchar(128),
  ADD COLUMN IF NOT EXISTS serial_photo_url text,
  ADD COLUMN IF NOT EXISTS serial_confirmed_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_case_work_unit_device_serial
  ON case_work_unit (service_case_id, device_serial)
  WHERE device_serial IS NOT NULL;
