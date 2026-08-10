-- 用户工号
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS employee_no varchar(32) NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_employee_no
  ON users (employee_no)
  WHERE employee_no IS NOT NULL AND TRIM(employee_no) <> '';
