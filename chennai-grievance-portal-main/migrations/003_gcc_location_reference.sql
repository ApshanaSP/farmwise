-- ---------------------------------------------------------------------------
-- 003  Verified GCC location reference data + manual street entry
-- ---------------------------------------------------------------------------
-- The existing `localities` (32 rows) and `streets` (192 rows, exactly 6 per
-- locality) tables are placeholder seed data. This migration adds the real GCC
-- Area -> Locality -> Street chain imported from the GCC PGR site, and an
-- authoritative ward -> zone table derived from ward boundary polygons.
--
-- NON-DESTRUCTIVE: the old `localities` / `streets` tables are kept so existing
-- complaints still resolve their location names. New complaints write to the
-- gcc_* columns instead.
--
-- WARD DATA — IMPORTANT
-- ---------------------
-- GCC's citizen complaint page exposes Area / Locality / Street but NOT ward
-- numbers, so there is no authoritative Area -> Ward mapping to import. Ward is
-- therefore resolved geometrically, by point-in-polygon against ward boundary
-- polygons (see data/boundaries/). `zone_wards` below is the ward -> zone
-- mapping derived from those polygons; it replaces the ward_start/ward_end
-- ranges in `zones`, which disagreed with the boundary data for 124 of 200
-- wards and could not represent Adyar/Perungudi (whose ward spans overlap).
-- ---------------------------------------------------------------------------

CREATE TABLE gcc_areas (
  id      INT AUTO_INCREMENT PRIMARY KEY,
  gcc_id  INT NOT NULL COMMENT 'AREAID on the GCC PGR site',
  name    VARCHAR(190) NOT NULL,
  UNIQUE KEY uq_gcc_areas_gcc_id (gcc_id),
  KEY idx_gcc_areas_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE gcc_localities (
  id      INT AUTO_INCREMENT PRIMARY KEY,
  gcc_id  INT NOT NULL COMMENT 'Locality ID on the GCC PGR site',
  name    VARCHAR(190) NOT NULL,
  area_id INT NOT NULL,
  UNIQUE KEY uq_gcc_localities_gcc_id (gcc_id),
  KEY idx_gcc_localities_area (area_id),
  CONSTRAINT fk_gcc_locality_area FOREIGN KEY (area_id)
    REFERENCES gcc_areas (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE gcc_streets (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  gcc_id      INT NOT NULL COMMENT 'STREETID on the GCC PGR site',
  name        VARCHAR(255) NOT NULL,
  locality_id INT NOT NULL,
  UNIQUE KEY uq_gcc_streets_gcc_id (gcc_id),
  KEY idx_gcc_streets_locality (locality_id),
  CONSTRAINT fk_gcc_street_locality FOREIGN KEY (locality_id)
    REFERENCES gcc_localities (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Authoritative ward -> zone mapping, one row per GCC ward.
CREATE TABLE zone_wards (
  ward_number  INT NOT NULL PRIMARY KEY,
  zone_id      INT NOT NULL,
  source       VARCHAR(255) NULL COMMENT 'Dataset the mapping came from',
  source_version VARCHAR(64) NULL COMMENT 'fetchedAt of that dataset',
  KEY idx_zone_wards_zone (zone_id),
  CONSTRAINT fk_zone_wards_zone FOREIGN KEY (zone_id)
    REFERENCES zones (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Record where each reference dataset came from and when, so the app can show
-- its own data provenance instead of implying the data is authoritative.
CREATE TABLE reference_data_sources (
  dataset      VARCHAR(64) NOT NULL PRIMARY KEY,
  source_url   VARCHAR(500) NULL,
  source_label VARCHAR(255) NULL,
  is_official  TINYINT(1) NOT NULL DEFAULT 0,
  fetched_at   DATETIME NULL,
  row_count    INT NULL,
  notes        TEXT NULL,
  updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- Complaint location columns
-- ---------------------------------------------------------------------------
ALTER TABLE complaints
  MODIFY COLUMN locality_id INT NULL,
  MODIFY COLUMN street_id   INT NULL,
  ADD COLUMN gcc_area_id     INT NULL,
  ADD COLUMN gcc_locality_id INT NULL,
  ADD COLUMN gcc_street_id   INT NULL
    COMMENT 'NULL when the citizen typed the street manually',
  ADD COLUMN manual_street_name VARCHAR(255) NULL
    COMMENT 'Street typed by the citizen when it is missing from the GCC list',
  ADD COLUMN street_type VARCHAR(60) NULL
    COMMENT 'Street / Road / Avenue / ... kept separate from the street name',
  ADD COLUMN ward_source ENUM('map_boundary','user_selected','legacy') NULL
    COMMENT 'How ward_number was determined for this complaint',
  ADD CONSTRAINT fk_complaints_gcc_area FOREIGN KEY (gcc_area_id)
    REFERENCES gcc_areas (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_complaints_gcc_locality FOREIGN KEY (gcc_locality_id)
    REFERENCES gcc_localities (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_complaints_gcc_street FOREIGN KEY (gcc_street_id)
    REFERENCES gcc_streets (id) ON DELETE RESTRICT;

CREATE INDEX idx_complaints_gcc_locality ON complaints (gcc_locality_id);

-- Complaints that predate this migration had their ward typed by the citizen.
UPDATE complaints SET ward_source = 'legacy' WHERE ward_source IS NULL;
