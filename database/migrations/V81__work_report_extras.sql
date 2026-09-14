-- Files attached to a work report, and the daily nudge for a missing one.

-- Comma-separated upload paths, exactly as chat attachments are stored. Null
-- means what it has always meant: a report with nothing attached.
ALTER TABLE work_reports
    ADD COLUMN attachments TEXT NULL;

-- The reminder for an employee who has not filed today's report. Switched on,
-- because it was asked for; the hour is whatever suits the office.
INSERT INTO system_settings (setting_key, setting_value)
SELECT 'workreport.reminder_enabled', 'true' FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM system_settings WHERE setting_key = 'workreport.reminder_enabled');

INSERT INTO system_settings (setting_key, setting_value)
SELECT 'workreport.reminder_time', '18:30' FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM system_settings WHERE setting_key = 'workreport.reminder_time');

-- The day the reminder last went out, so a restart cannot send it twice.
INSERT INTO system_settings (setting_key, setting_value)
SELECT 'workreport.reminder_last_run', '' FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM system_settings WHERE setting_key = 'workreport.reminder_last_run');
