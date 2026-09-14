-- ============================================================
-- V32 — Team-wise task assignment.
-- ------------------------------------------------------------
-- A task can be assigned to a whole team (designation). Each
-- member still gets their own task row so they can complete it,
-- but the rows share a team_batch_id and carry the team_name so
-- the admin view can collapse them into a single "team" row.
-- Individual tasks leave both columns NULL.
-- ============================================================

ALTER TABLE tasks
    ADD COLUMN team_batch_id VARCHAR(40) NULL,
    ADD COLUMN team_name VARCHAR(150) NULL;

CREATE INDEX idx_tasks_team_batch ON tasks (team_batch_id);
