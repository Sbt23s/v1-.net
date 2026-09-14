-- A conversation attached to each task, and the nudges as its due date arrives.

CREATE TABLE task_messages (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    task_id     BIGINT   NOT NULL,
    sender_id   BIGINT   NOT NULL,
    content     TEXT     NULL,
    -- Comma-separated upload paths, as chat and work reports store theirs.
    attachments TEXT     NULL,
    sent_at     DATETIME NOT NULL,
    CONSTRAINT fk_task_msg_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);
CREATE INDEX idx_task_msg ON task_messages (task_id, sent_at);

-- The day each kind of reminder last went out for a task, so none is repeated.
-- Null means it has never been sent, which is where every task starts.
ALTER TABLE tasks
    ADD COLUMN reminded_before  DATE NULL,
    ADD COLUMN reminded_due     DATE NULL,
    ADD COLUMN reminded_overdue DATE NULL;

INSERT INTO system_settings (setting_key, setting_value)
SELECT 'task.reminder_enabled', 'true' FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM system_settings WHERE setting_key = 'task.reminder_enabled');

INSERT INTO system_settings (setting_key, setting_value)
SELECT 'task.reminder_time', '09:30' FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM system_settings WHERE setting_key = 'task.reminder_time');

-- How many days before the due date the first reminder goes out.
INSERT INTO system_settings (setting_key, setting_value)
SELECT 'task.reminder_lead_days', '1' FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM system_settings WHERE setting_key = 'task.reminder_lead_days');
