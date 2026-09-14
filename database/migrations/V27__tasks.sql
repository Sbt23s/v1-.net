-- ============================================================
-- V27 — Task assignment.
-- ------------------------------------------------------------
-- Admin/HR assign tasks to an employee. The employee sees their
-- tasks and marks them complete; admins see everyone's tasks
-- grouped per employee (split by industry in the UI).
-- ============================================================

CREATE TABLE IF NOT EXISTS tasks (
    id           BIGINT AUTO_INCREMENT PRIMARY KEY,
    title        VARCHAR(200) NOT NULL,
    description  TEXT,
    assigned_to  BIGINT NOT NULL,                          -- employee (users.id)
    assigned_by  BIGINT,                                   -- admin/HR who created it
    status       VARCHAR(20) NOT NULL DEFAULT 'PENDING',   -- PENDING | COMPLETED
    due_date     DATE,
    created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    CONSTRAINT fk_task_assignee FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_task_assigner FOREIGN KEY (assigned_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX idx_tasks_assigned_to ON tasks (assigned_to);
CREATE INDEX idx_tasks_status      ON tasks (status);
