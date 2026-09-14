-- ============================================================
-- V25 — Normalize user industry values to canonical IT / CIVIL
-- ------------------------------------------------------------
-- The application stores the industry as 'IT' / 'CIVIL' and renders
-- them in the UI as "DIGITAL" / "INFRA". Some rows (and the column
-- default) had been saved with the display labels instead of the
-- canonical codes, so the Employees "Digital" filter (industry=IT)
-- matched nothing. Bring the data back to the canonical codes.
-- ============================================================

UPDATE users SET industry = 'IT'    WHERE UPPER(industry) IN ('DIGITAL', 'IT');
UPDATE users SET industry = 'CIVIL' WHERE UPPER(industry) IN ('INFRA', 'CIVIL');

-- Restore the canonical column default (was changed to 'DIGITAL').
ALTER TABLE users ALTER COLUMN industry SET DEFAULT 'IT';
