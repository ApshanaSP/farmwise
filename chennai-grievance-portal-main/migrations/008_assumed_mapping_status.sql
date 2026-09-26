-- ---------------------------------------------------------------------------
-- 008  Distinguish an assumed department routing from a published one
-- ---------------------------------------------------------------------------
-- Every complaint type now carries a department so nothing lands unrouted.
-- Most of those routings are this application's own best fit rather than
-- something GCC publishes, and that difference must stay visible: 'mapped'
-- means the department follows unambiguously from the category, 'assumed'
-- means we chose it and an officer should confirm, 'unmapped' means no fixed
-- department (only "Other", routed by the classifier at submit time).
-- ---------------------------------------------------------------------------

ALTER TABLE complaint_subtypes
  MODIFY COLUMN mapping_status ENUM('mapped','assumed','unmapped')
    NOT NULL DEFAULT 'unmapped';
