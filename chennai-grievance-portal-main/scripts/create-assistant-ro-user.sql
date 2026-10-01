-- =============================================================================
-- Ask District IQ: a SELECT-only MySQL account for the assistant's ad-hoc queries.
--
-- The assistant answers most questions through the console's own data functions. For the
-- rest it compiles a validated query plan into one parameterized SELECT and runs it on a
-- separate connection pool as this account. Even a compiler bug then cannot write, drop or
-- read a secret: the account can read the intelligence store (district_intel) and only the
-- listed columns of the dashboard's price, contact and source tables (no phone numbers,
-- emails, URLs, logins or secrets). The columns match src/lib/assistant/catalog.ts.
--
-- Run once, as an administrator, after replacing CHANGE_ME with a long random password:
--   mysql -u root -p < scripts/create-assistant-ro-user.sql
-- Then add the account to .env (never commit the real password):
--   ASSISTANT_RO_DB_USER=diq_assistant_ro
--   ASSISTANT_RO_DB_PASSWORD=<the password you chose>
--
-- If INTEL_DB_NAME or INTEL_OPS_DB_NAME are not the defaults, change the database names
-- below. If the app connects to MySQL by IP address rather than "localhost", repeat the
-- CREATE USER and GRANT lines for 'diq_assistant_ro'@'127.0.0.1'.
-- Safe to re-run: an existing account keeps its password and gains any missing grant.
-- =============================================================================

CREATE USER IF NOT EXISTS 'diq_assistant_ro'@'localhost'
  IDENTIFIED BY 'CHANGE_ME'
  WITH MAX_USER_CONNECTIONS 4;

-- The intelligence store is replaced by every pipeline export; a database-level grant
-- survives that. The assistant's catalog decides which tables and columns are queried.
GRANT SELECT ON `district_intel`.* TO 'diq_assistant_ro'@'localhost';

-- The dashboard's own database: listed columns only.
GRANT SELECT (`date`, `market`, `commodity`, `variety`, `cmdt_group`, `min_price`, `max_price`, `modal_price`, `arrival`)
  ON `district_intel_ops`.`mandi_market_prices` TO 'diq_assistant_ro'@'localhost';
GRANT SELECT (`date`, `scope`, `commodity`, `cmdt_group`, `price`, `arrival`, `msp`)
  ON `district_intel_ops`.`mandi_prices` TO 'diq_assistant_ro'@'localhost';
GRANT SELECT (`week_start`, `week_label`, `scope`, `commodity`, `price`, `districts`, `chg_week`, `chg_month`, `chg_year`)
  ON `district_intel_ops`.`mandi_weekly` TO 'diq_assistant_ro'@'localhost';
GRANT SELECT (`contact_id`, `grp`, `dept_code`, `zone_no`, `region`, `rank`, `name`, `designation`, `office`, `source_url`, `retrieved_on`)
  ON `district_intel_ops`.`official_contacts` TO 'diq_assistant_ro'@'localhost';
GRANT SELECT (`incident_id`, `dept_code`, `reason`, `status`, `assigned_at`)
  ON `district_intel_ops`.`dept_assignments` TO 'diq_assistant_ro'@'localhost';
GRANT SELECT (`source_id`, `name`, `kind`, `description`, `pipeline_key`, `refresh_minutes`, `enabled`, `status`, `last_run_at`, `last_ok_at`, `items_total`)
  ON `district_intel_ops`.`sources` TO 'diq_assistant_ro'@'localhost';

SHOW GRANTS FOR 'diq_assistant_ro'@'localhost';
