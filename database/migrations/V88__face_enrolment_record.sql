-- ============================================================
-- V88 — The enrolment photo, and who registered it.
--
-- The face service keeps only measurements: a 128-value encoding per photo, from
-- which no picture can be recovered. That is the right thing for the matching
-- itself, but it means nobody could look at a profile and see whose face is
-- registered — HR registers it on somebody's behalf and then has no way to check
-- they registered the right person.
--
-- One photo is kept here for exactly that: to be looked at. It sits in the same
-- storage as profile photos and is served the same way. The encodings the matching
-- uses stay where they are; this changes nothing about how a punch is verified.
-- ============================================================

ALTER TABLE users
    ADD COLUMN face_photo_path     VARCHAR(255) NULL,
    ADD COLUMN face_registered_at  DATETIME     NULL,
    -- Registering somebody else's face is an act worth attributing.
    ADD COLUMN face_registered_by  BIGINT       NULL;

ALTER TABLE users
    ADD CONSTRAINT fk_users_face_by
    FOREIGN KEY (face_registered_by) REFERENCES users(id) ON DELETE SET NULL;
