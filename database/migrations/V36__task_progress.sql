-- ============================================================
-- V36 — Task progress percentage.
-- ------------------------------------------------------------
-- Employees update how far along a task is (0–100%). Admins see
-- the live progress in the Tasks view. 100% marks it completed.
-- ============================================================

ALTER TABLE tasks
    ADD COLUMN progress INT NOT NULL DEFAULT 0;

-- Existing completed tasks should read as 100%.
UPDATE tasks SET progress = 100 WHERE status = 'COMPLETED';
