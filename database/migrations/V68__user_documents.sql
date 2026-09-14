-- ============================================================
-- Paperwork that belongs to an employee: an offer letter, an ID
-- scan, a certificate. Stored the same way attachments are
-- everywhere else in this app -- a comma-separated list of upload
-- paths -- so one column is enough and nothing else changes.
-- ============================================================

ALTER TABLE users
    ADD COLUMN documents TEXT NULL AFTER photo_path;
