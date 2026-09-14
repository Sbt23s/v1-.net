-- ============================================================
-- V85 — Face verification on a punch, and the photo it was verified from.
--
-- The face service was already there and already worked; nothing recorded that a
-- punch had been through it. So a verified punch and an unverified one looked
-- identical afterwards, which makes the verification worth very little: the whole
-- point is to be able to say later that this person was there.
--
-- Additive only. Every existing punch reads as unverified with no photo, which is
-- exactly what it was.
-- ============================================================

ALTER TABLE attendance
    -- Whether the face matched at punch-in, and the selfie it matched against.
    ADD COLUMN face_verified      BOOLEAN      NOT NULL DEFAULT FALSE,
    ADD COLUMN face_photo_path    VARCHAR(255) NULL,
    -- How close the match was. Lower is closer; the service compares against a
    -- tolerance. Kept because "it matched" hides whether it barely matched.
    ADD COLUMN face_score         DECIMAL(5,4) NULL,
    -- The same three for punch-out, which is a separate act at a separate time.
    ADD COLUMN out_face_verified  BOOLEAN      NOT NULL DEFAULT FALSE,
    ADD COLUMN out_face_photo_path VARCHAR(255) NULL,
    ADD COLUMN out_face_score     DECIMAL(5,4) NULL;

-- Finding the unverified punches in a month is the query HR will actually run.
CREATE INDEX idx_attendance_face ON attendance (work_date, face_verified);
