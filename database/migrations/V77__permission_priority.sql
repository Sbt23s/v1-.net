-- ============================================================
-- V77 — how urgent a permission request is.
--
-- Some are routine and some cannot wait, and an approver had no way
-- of telling them apart. HIGH | MEDIUM | LOW, defaulting to MEDIUM
-- so every existing row reads sensibly without being rewritten.
-- ============================================================

ALTER TABLE permission_requests
    ADD COLUMN priority VARCHAR(10) NOT NULL DEFAULT 'MEDIUM' AFTER reason;
