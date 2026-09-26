-- ---------------------------------------------------------------------------
-- 006  Area -> ward mapping, and a local "Other" complaint type
-- ---------------------------------------------------------------------------
-- AREA -> WARD
-- The ward dropdown should offer only the wards belonging to the selected
-- area. GCC still publishes no such mapping (see 004), so this one is DERIVED,
-- not authoritative:
--
--   1. each GCC area name is geocoded against OpenStreetMap to get a point and
--      a bounding box;
--   2. every ward polygon intersecting that box becomes a candidate ward, and
--      the ward containing the point is marked primary.
--
-- That is good enough to shrink a 200-item dropdown to a handful, and not good
-- enough to file a complaint against. Rows are stored with
-- confidence = 'derived', the UI labels them as approximate, and a ward
-- resolved from an actual map pin always overrides them.
--
-- `locality_wards` from 004 stays; this table is the area-level equivalent now
-- that the form asks for area + street rather than area + locality + street.
-- ---------------------------------------------------------------------------

CREATE TABLE area_wards (
  area_id        INT NOT NULL,
  ward_number    INT NOT NULL,
  is_primary     TINYINT(1) NOT NULL DEFAULT 0
    COMMENT 'The ward containing the geocoded centre point of the area',
  confidence     ENUM('verified','derived') NOT NULL DEFAULT 'derived',
  source         VARCHAR(255) NULL,
  source_version VARCHAR(64) NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (area_id, ward_number),
  KEY idx_area_wards_ward (ward_number),
  CONSTRAINT fk_area_wards_area FOREIGN KEY (area_id)
    REFERENCES gcc_areas (id) ON DELETE CASCADE,
  CONSTRAINT fk_area_wards_ward FOREIGN KEY (ward_number)
    REFERENCES zone_wards (ward_number) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- "OTHER" COMPLAINT TYPE
-- GCC's published list has no general catch-all, so this one is added locally
-- for citizens whose issue is not covered. It is marked with a negative gcc_id
-- so it can never be confused with a real GCC option, carries no department,
-- and is always flagged for an officer to route.
-- ---------------------------------------------------------------------------

INSERT INTO complaint_categories (name, sort_order, source, source_fetched_at)
VALUES ('Other', 999, 'Added locally - not published by GCC', NULL)
ON DUPLICATE KEY UPDATE sort_order = VALUES(sort_order), source = VALUES(source);

INSERT INTO complaint_subtypes
  (category_id, gcc_id, label, department_id, mapping_status, is_frequent, sort_order)
SELECT id, -1, 'Other / not listed above', NULL, 'unmapped', 0, 0
  FROM complaint_categories WHERE name = 'Other'
ON DUPLICATE KEY UPDATE label = VALUES(label), is_active = 1;
