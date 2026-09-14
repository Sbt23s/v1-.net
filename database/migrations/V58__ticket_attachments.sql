-- ============================================================
-- Support tickets can carry screenshots and documents, so HR sees
-- the problem rather than only a description of it. Stored the same
-- way claim photos are: a comma-separated list of upload paths.
-- ============================================================

ALTER TABLE tickets
    ADD COLUMN attachments TEXT NULL AFTER description;
