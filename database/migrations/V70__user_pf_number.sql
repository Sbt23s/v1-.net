-- ============================================================
-- V70 — PF number on the employee record.
--
-- Collected on the joining form beside the bank details, where it
-- belongs, and optional: not everybody has one on day one.
-- ============================================================

ALTER TABLE users ADD COLUMN pf_number VARCHAR(30) NULL AFTER pan;
