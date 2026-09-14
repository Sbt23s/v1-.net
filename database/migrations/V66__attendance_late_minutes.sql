-- ============================================================
-- How late a punch was, in minutes. The late flag alone said
-- whether someone was late but never by how much, so a month's
-- summary could not report the time lost.
-- ============================================================

ALTER TABLE attendance
    ADD COLUMN late_minutes INT NOT NULL DEFAULT 0 AFTER is_late;
