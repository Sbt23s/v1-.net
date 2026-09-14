-- ============================================================
-- A complaint or need is now addressed to a specific HR person,
-- the same way a leave or permission request is. Existing rows
-- keep NULL, which means "any HR may pick it up".
-- ============================================================

ALTER TABLE complaints_needs
    ADD COLUMN requested_to BIGINT NULL AFTER raised_by;

CREATE INDEX idx_cn_requested_to ON complaints_needs (requested_to);
