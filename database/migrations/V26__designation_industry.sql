-- ============================================================
-- V26 — Tag designations by industry.
-- ------------------------------------------------------------
-- The employee-add form should offer only the designations that
-- belong to the chosen industry: IT/Digital roles for Digital,
-- and the infra/construction roles for Infra (Civil).
-- ============================================================

ALTER TABLE designations
    ADD COLUMN industry VARCHAR(20) NOT NULL DEFAULT 'IT'; -- IT | CIVIL

-- All existing designations are digital / IT roles.
UPDATE designations SET industry = 'IT';

-- Infra / civil designations (shown only when Industry = Civil).
INSERT INTO designations (name, code, industry, active) VALUES
 ('PMC Workers',          'PMC_WRK', 'CIVIL', 1),
 ('Construction Workers', 'CON_WRK', 'CIVIL', 1),
 ('Other Works',          'OTH_WRK', 'CIVIL', 1);
