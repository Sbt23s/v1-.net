-- ============================================================
-- V12 — Switch authentication to username + password.
--   * Adds a `username` column (unique) used for login.
--   * Aadhaar becomes an OPTIONAL profile detail (nullable, still unique
--     when present) and is no longer used to sign in.
--   * Existing seeded users are given readable usernames so the demo
--     logins keep working with the same password (Test1234@).
-- ============================================================

-- 1) Add the username column (nullable first so we can backfill safely).
ALTER TABLE users
    ADD COLUMN username VARCHAR(60) NULL AFTER employee_code;

-- 2) Backfill usernames for the demo/seed users created in V8.
UPDATE users SET username = 'arun'    WHERE employee_code = 'EMP0001' AND username IS NULL;
UPDATE users SET username = 'divya'   WHERE employee_code = 'EMP0002' AND username IS NULL;
UPDATE users SET username = 'karthik' WHERE employee_code = 'EMP0003' AND username IS NULL;
UPDATE users SET username = 'priya'   WHERE employee_code = 'EMP0004' AND username IS NULL;
UPDATE users SET username = 'rajesh'  WHERE employee_code = 'EMP0005' AND username IS NULL;
UPDATE users SET username = 'admin'   WHERE employee_code = 'ADM0001' AND username IS NULL;

-- 3) Any other rows without a username fall back to their employee_code
--    (lower-cased) so the NOT NULL + UNIQUE constraints can be applied.
UPDATE users
   SET username = LOWER(employee_code)
 WHERE username IS NULL AND employee_code IS NOT NULL;

-- 4) Enforce NOT NULL + UNIQUE on username now that every row has one.
ALTER TABLE users
    MODIFY COLUMN username VARCHAR(60) NOT NULL;
ALTER TABLE users
    ADD CONSTRAINT uq_users_username UNIQUE (username);

-- 5) Aadhaar is now optional. Drop the NOT NULL requirement but keep a
--    unique index so two people can't share the same Aadhaar when supplied.
--    (MySQL/MariaDB allow multiple NULLs under a UNIQUE index.)
ALTER TABLE users
    MODIFY COLUMN aadhar VARCHAR(12) NULL;

-- Phone likewise becomes optional for admin-created accounts.
ALTER TABLE users
    MODIFY COLUMN phone VARCHAR(15) NULL;

-- 6) login_history recorded the aadhar of each attempt; keep the column for
--    history but add a username column for the new login identifier.
ALTER TABLE login_history
    ADD COLUMN username VARCHAR(60) NULL AFTER aadhar;
