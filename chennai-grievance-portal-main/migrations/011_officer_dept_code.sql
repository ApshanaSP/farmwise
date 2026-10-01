-- Department officers for departments outside the 16 GCC departments (Police,
-- Metrowater, PWD, TANGEDCO, District Revenue, ...). `department_id` can only point
-- at the portal's GCC departments, so these officers are linked by the district
-- intelligence store's department code instead (ref_departments.code, e.g. POL-GCP).
-- GCC officers keep working through department_id; dept_code, when set, wins.
-- Additive: no existing column or row is changed.
ALTER TABLE users
  ADD COLUMN dept_code VARCHAR(16) NULL AFTER department_id,
  ADD INDEX idx_users_dept_code (dept_code);
