-- ============================================================
-- V101 - An entrance effect on the login announcement.
--
-- The announcement already carries one piece of media. This adds a second,
-- optional one: a Lottie animation played over the top of it when the popup
-- opens, so a poster can arrive with light sweeping across it rather than
-- simply appearing.
--
-- Kept as its own columns rather than reusing media_url. The two are shown at
-- the same time, one on top of the other, so one field cannot hold both -- and
-- an effect is optional where the media is required.
--
-- effect_enabled is separate from effect_url on purpose. Switching an effect
-- off should not mean re-uploading it to switch it back on; a company trying
-- one out for a day needs a toggle, not a delete.
-- ============================================================

ALTER TABLE global_login_announcements
    ADD COLUMN effect_url     VARCHAR(1000) NULL,
    ADD COLUMN effect_name    VARCHAR(255)  NULL,
    ADD COLUMN effect_size    BIGINT        NULL,
    ADD COLUMN effect_enabled BOOLEAN       NOT NULL DEFAULT FALSE;
