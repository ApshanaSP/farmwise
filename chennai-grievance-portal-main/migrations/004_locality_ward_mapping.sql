-- ---------------------------------------------------------------------------
-- 004  Area/locality -> ward mapping (intentionally empty on install)
-- ---------------------------------------------------------------------------
-- The requirement is that selecting an area narrows the ward dropdown to the
-- wards belonging to that area. No authoritative dataset for that mapping is
-- currently obtainable:
--
--   * GCC's citizen complaint page exposes Area -> Locality -> Street and does
--     not carry ward numbers at all.
--   * GCC's own GIS server could not be read (expired TLS certificate).
--   * Ward boundary polygons give ward geometry, but the GCC locality lists
--     carry no coordinates, so localities cannot be placed inside a ward
--     without geocoding all ~4,900 of them — which would produce a *derived*
--     mapping, not a verified one.
--
-- Rather than invent the mapping, this table exists and stays EMPTY until real
-- data is loaded. The application checks it:
--
--   * rows present for the selected area -> the ward dropdown is filtered to
--     them, and a single unambiguous match is auto-filled;
--   * no rows              -> the ward dropdown lists every GCC ward grouped
--                             by zone, labelled "Ward N - <zone>", and the UI
--                             states that no verified area-to-ward mapping is
--                             loaded and that placing a map pin is the reliable
--                             way to determine the ward.
--
-- A locality may legitimately span several wards, so the primary key is the
-- (locality, ward) pair rather than the locality alone.
-- ---------------------------------------------------------------------------

CREATE TABLE locality_wards (
  locality_id    INT NOT NULL,
  ward_number    INT NOT NULL,
  confidence     ENUM('verified','derived') NOT NULL DEFAULT 'derived'
    COMMENT 'verified = from an authoritative published mapping; derived = computed',
  source         VARCHAR(255) NULL,
  source_version VARCHAR(64) NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (locality_id, ward_number),
  KEY idx_locality_wards_ward (ward_number),
  CONSTRAINT fk_locality_wards_locality FOREIGN KEY (locality_id)
    REFERENCES gcc_localities (id) ON DELETE CASCADE,
  CONSTRAINT fk_locality_wards_ward FOREIGN KEY (ward_number)
    REFERENCES zone_wards (ward_number) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO reference_data_sources
  (dataset, source_url, source_label, is_official, fetched_at, row_count, notes)
VALUES (
  'locality_wards',
  NULL,
  'No source loaded',
  0,
  NULL,
  0,
  'Empty by design. No authoritative area/locality -> ward mapping was obtainable: GCC publishes Area -> Locality -> Street without ward numbers, and its GIS server had an expired TLS certificate. Until this table is populated, ward is resolved from map coordinates by point-in-polygon, or chosen by the citizen from the full ward list grouped by zone.'
)
ON DUPLICATE KEY UPDATE notes = VALUES(notes);
