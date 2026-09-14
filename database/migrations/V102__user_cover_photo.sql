-- ============================================================
-- V102 - a cover image for the dashboard banner.
--
-- The banner on an employee's dashboard is a flat colour. This lets each
-- person put their own image or short video behind it, the way a profile
-- header works elsewhere, without affecting anything that reads the profile
-- photo: the two are separate fields with separate purposes.
--
-- Nullable with no default, so every existing row keeps the plain banner and
-- nothing needs backfilling.
-- ============================================================

ALTER TABLE users
    ADD COLUMN cover_photo_path VARCHAR(512) NULL AFTER photo_path;
