-- Task priority: LOW | MEDIUM | HIGH (set when assigning a task).
ALTER TABLE tasks ADD COLUMN priority VARCHAR(10) NOT NULL DEFAULT 'MEDIUM';
