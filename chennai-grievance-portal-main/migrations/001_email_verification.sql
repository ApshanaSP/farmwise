-- ---------------------------------------------------------------------------
-- 001  Email verification at registration
-- ---------------------------------------------------------------------------
-- Adds verification state to `users` and a dedicated OTP purpose so that
-- registration verification never shares a code with password reset or mobile
-- verification.
--
-- HANDLING OF EXISTING ACCOUNTS
-- -----------------------------
-- Accounts that already exist when this migration runs are NOT marked as
-- verified — their `email_verified_at` stays NULL, because nobody ever proved
-- those addresses. They are instead flagged `email_verification_exempt = 1`,
-- which grandfathers them so they keep signing in. The distinction is
-- deliberate: the app can tell "verified" from "predates verification", and you
-- can later force a re-verification campaign by clearing the exempt flag:
--
--   UPDATE users SET email_verification_exempt = 0 WHERE email_verified_at IS NULL;
--
-- Accounts created after this migration default to exempt = 0 and must verify.
-- ---------------------------------------------------------------------------

ALTER TABLE users
  ADD COLUMN email_verified_at DATETIME NULL DEFAULT NULL
    COMMENT 'When this email address was proven via a registration code. NULL = never verified.',
  ADD COLUMN email_verification_exempt TINYINT(1) NOT NULL DEFAULT 0
    COMMENT 'Grandfathered account that predates email verification; may sign in unverified.';

-- Grandfather every account that exists right now.
UPDATE users SET email_verification_exempt = 1 WHERE email_verified_at IS NULL;

CREATE INDEX idx_users_email_verified ON users (email_verified_at);

-- Registration verification gets its own OTP purpose, kept separate from
-- password_reset / mobile_verify / complaint_mobile_verify.
ALTER TABLE password_resets
  MODIFY COLUMN purpose
    ENUM('password_reset','mobile_verify','complaint_mobile_verify','email_verify')
    NOT NULL;

-- consumeOtp()/verifyOtp() always read the newest unused row for an
-- (identifier, purpose) pair; this index keeps that lookup cheap.
CREATE INDEX idx_password_resets_lookup
  ON password_resets (identifier, purpose, used, created_at);
