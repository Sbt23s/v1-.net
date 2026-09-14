-- ============================================================
-- Chat messages can carry files — images, video, PDFs, documents.
-- Stored the same way ticket and claim attachments are: a
-- comma-separated list of upload paths alongside the text.
-- ============================================================

ALTER TABLE community_messages
    ADD COLUMN attachments TEXT NULL AFTER audio_path;
