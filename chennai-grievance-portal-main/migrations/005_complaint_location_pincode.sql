-- ---------------------------------------------------------------------------
-- 005  Separate PIN code for the complaint location
-- ---------------------------------------------------------------------------
-- `complaints.pincode` is part of the complainant's own contact details and is
-- prefilled from their profile. The PIN code of the place being reported is a
-- different fact — a citizen can report a pothole outside their own area — so
-- map autofill must never overwrite the personal one.
-- ---------------------------------------------------------------------------

ALTER TABLE complaints
  ADD COLUMN location_pincode VARCHAR(10) NULL
    COMMENT 'PIN code of the reported location, distinct from the complainant pincode';
