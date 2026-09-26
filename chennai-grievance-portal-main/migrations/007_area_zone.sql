-- ---------------------------------------------------------------------------
-- 007  Materialise each GCC area's zone
-- ---------------------------------------------------------------------------
-- The complaint form now asks for a GCC *zone* rather than one of the 250 PGR
-- "areas": a zone is an official Chennai Corporation administrative division,
-- there are only 15 of them, the map pin resolves one exactly (ward polygon ->
-- zone), and zone -> ward is an exact published mapping rather than a derived
-- one.
--
-- Streets remain attached to areas, so an area needs to know its zone in order
-- for "streets in this zone" to be answerable. That is filled in by
-- scripts/derive-area-zones.js from the area_wards mapping, so it inherits the
-- same 'derived' caveat: it is used to GROUP streets, never to decide which
-- ward a complaint belongs to.
-- ---------------------------------------------------------------------------

ALTER TABLE gcc_areas
  ADD COLUMN zone_id INT NULL
    COMMENT 'Derived from area_wards; groups streets by zone. Not authoritative.',
  ADD CONSTRAINT fk_gcc_areas_zone FOREIGN KEY (zone_id)
    REFERENCES zones (id) ON DELETE SET NULL;

CREATE INDEX idx_gcc_areas_zone ON gcc_areas (zone_id);
