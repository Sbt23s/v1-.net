-- ============================================================
-- V31 — Add two more Digital/IT designations.
-- ------------------------------------------------------------
-- INSERT IGNORE keeps this safe/idempotent: if the unique code
-- already exists, the row is skipped instead of erroring.
-- industry = 'IT' so they appear under the Digital category.
-- ============================================================

INSERT IGNORE INTO designations (name, code, industry, active) VALUES
 ('DevOps Engineer',  'DEVOPS',  'IT', TRUE),
 ('Mobile Developer', 'MOB_DEV', 'IT', TRUE);
