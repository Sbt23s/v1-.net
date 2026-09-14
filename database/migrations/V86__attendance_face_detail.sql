-- ============================================================
-- V86 — Everything the face check actually measured, kept with the punch.
--
-- V85 stored whether the face matched and how closely. That is the verdict, not
-- the working: an admin looking at a punch afterwards could not see whether the
-- eyes were open, how well lit the frame was, how many faces were in it, or
-- whether liveness was even checked. Those are the questions asked when a punch
-- is disputed, and answering them a month later means storing them now.
--
-- Kept as JSON rather than thirty columns because the set of signals will grow,
-- and because none of it is ever queried by field — it is read back whole,
-- alongside one punch, by one person asking about that punch.
-- ============================================================

ALTER TABLE attendance
    ADD COLUMN face_detail      TEXT NULL,
    ADD COLUMN out_face_detail  TEXT NULL,
    -- How accurate the phone said its own location was, in metres. A punch
    -- recorded from a 2 km fix and one from a 10 m fix are not the same evidence,
    -- and without this they looked identical.
    ADD COLUMN in_accuracy_m    INT  NULL,
    ADD COLUMN out_accuracy_m   INT  NULL,
    -- What it was punched from. A punch from an unexpected device is worth
    -- noticing; one that never records the device cannot be.
    ADD COLUMN in_device        VARCHAR(255) NULL,
    ADD COLUMN out_device       VARCHAR(255) NULL;
