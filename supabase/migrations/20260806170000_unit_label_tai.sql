-- 单元称呼统一为「台」
UPDATE inspection_templates SET unit_label = '台' WHERE unit_label IS DISTINCT FROM '台';
UPDATE service_case SET unit_label = '台' WHERE unit_label IS DISTINCT FROM '台';

ALTER TABLE inspection_templates
  ALTER COLUMN unit_label SET DEFAULT '台';
ALTER TABLE service_case
  ALTER COLUMN unit_label SET DEFAULT '台';
