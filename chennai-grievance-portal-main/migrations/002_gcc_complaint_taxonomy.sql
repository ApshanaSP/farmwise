-- ---------------------------------------------------------------------------
-- 002  GCC complaint category / subcomplaint taxonomy
-- ---------------------------------------------------------------------------
-- Replaces the hand-written 22-row `complaint_types` "Master List" with the
-- real category -> subcomplaint structure published by GCC on
--   https://erp.chennaicorporation.gov.in/pgr/citizen/BeforeReg.do
--
-- NON-DESTRUCTIVE: `complaint_types` is left in place and existing complaints
-- keep pointing at it. New complaints reference `complaint_subtypes` instead.
-- `complaints.complaint_type_id` becomes nullable so new rows can use the new
-- taxonomy; old rows are untouched and still render.
--
-- DEPARTMENT ROUTING: `complaint_subtypes.department_id` is NULL until a
-- mapping is supplied. GCC does not publish its internal department routing on
-- the citizen page, so the seeder maps only categories with an unambiguous
-- counterpart in this app's `departments` table and leaves the rest NULL with
-- mapping_status = 'unmapped'. Unmapped types are routed to a fallback
-- department AND flagged needs_manual_review so an officer re-routes them.
-- ---------------------------------------------------------------------------

CREATE TABLE complaint_categories (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  name         VARCHAR(150) NOT NULL,
  sort_order   INT NOT NULL DEFAULT 0,
  is_active    TINYINT(1) NOT NULL DEFAULT 1,
  source       VARCHAR(255) NULL COMMENT 'URL the category was imported from',
  source_fetched_at DATETIME NULL COMMENT 'When the source was read',
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_complaint_categories_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE complaint_subtypes (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  category_id    INT NOT NULL,
  gcc_id         INT NOT NULL COMMENT 'Stable option value from the GCC page',
  label          VARCHAR(255) NOT NULL,
  department_id  INT NULL COMMENT 'NULL until a department mapping is verified',
  mapping_status ENUM('mapped','unmapped') NOT NULL DEFAULT 'unmapped',
  is_frequent    TINYINT(1) NOT NULL DEFAULT 0,
  frequent_order INT NULL,
  sort_order     INT NOT NULL DEFAULT 0,
  is_active      TINYINT(1) NOT NULL DEFAULT 1,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_complaint_subtypes_gcc_id (gcc_id),
  KEY idx_complaint_subtypes_category (category_id),
  KEY idx_complaint_subtypes_frequent (is_frequent, frequent_order),
  CONSTRAINT fk_subtype_category FOREIGN KEY (category_id)
    REFERENCES complaint_categories (id) ON DELETE CASCADE,
  CONSTRAINT fk_subtype_department FOREIGN KEY (department_id)
    REFERENCES departments (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- New complaints reference the GCC taxonomy. Old complaints keep
-- complaint_type_id; exactly one of the two is set.
ALTER TABLE complaints
  MODIFY COLUMN complaint_type_id INT NULL,
  ADD COLUMN complaint_subtype_id INT NULL
    COMMENT 'GCC subcomplaint. New complaints use this; legacy rows use complaint_type_id.',
  ADD CONSTRAINT fk_complaints_subtype FOREIGN KEY (complaint_subtype_id)
    REFERENCES complaint_subtypes (id) ON DELETE RESTRICT;

CREATE INDEX idx_complaints_subtype ON complaints (complaint_subtype_id);
