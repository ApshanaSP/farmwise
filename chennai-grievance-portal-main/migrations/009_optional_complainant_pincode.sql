-- ---------------------------------------------------------------------------
-- 009  The complainant's own PIN code is optional; mobile is not
-- ---------------------------------------------------------------------------
-- The complaint form now requires first name, gender, address and mobile
-- number, and treats the complainant's own PIN code as optional — the location
-- of the problem is already pinned on a map and carries its own PIN code in
-- `location_pincode`, so demanding the complainant's as well was friction with
-- no purpose.
--
-- `mobile_number` stays nullable in the schema on purpose: complaints filed
-- before this change have none, and making the column NOT NULL would have
-- required inventing a value for them. The requirement is enforced at the API
-- boundary instead.
-- ---------------------------------------------------------------------------

ALTER TABLE complaints
  MODIFY COLUMN pincode VARCHAR(10) NULL
    COMMENT 'Complainant PIN code. Optional; the reported location has its own.';
