-- ============================================================
-- V23 — Seed company holiday calendar for 2026 so the Calendar
-- screen has real content out of the box. Admins/HR can add or
-- remove holidays anytime via Org > Holidays (POST/DELETE /api/org/holidays).
--
-- Idempotent: each row is inserted only if the same date+name is absent.
-- ============================================================

INSERT INTO holidays (name, holiday_date, state)
SELECT * FROM (
    SELECT 'New Year''s Day' AS name, DATE '2026-01-01' AS holiday_date, 'National' AS state UNION ALL
    SELECT 'Pongal',                  DATE '2026-01-14', 'Tamil Nadu' UNION ALL
    SELECT 'Thiruvalluvar Day',       DATE '2026-01-15', 'Tamil Nadu' UNION ALL
    SELECT 'Republic Day',            DATE '2026-01-26', 'National' UNION ALL
    SELECT 'Tamil New Year / Ambedkar Jayanti', DATE '2026-04-14', 'Tamil Nadu' UNION ALL
    SELECT 'May Day (Labour Day)',    DATE '2026-05-01', 'National' UNION ALL
    SELECT 'Independence Day',        DATE '2026-08-15', 'National' UNION ALL
    SELECT 'Gandhi Jayanti',          DATE '2026-10-02', 'National' UNION ALL
    SELECT 'Deepavali',               DATE '2026-11-08', 'National' UNION ALL
    SELECT 'Christmas',               DATE '2026-12-25', 'National'
) src
WHERE NOT EXISTS (
    SELECT 1 FROM holidays h
     WHERE h.holiday_date = src.holiday_date AND h.name = src.name
);
