-- ============================================================
-- V141 - What a biometric punch can say that a GPS punch cannot.
--
-- V140 gave punches a place to arrive and V4 of this work turned them into
-- attendance rows, but the row that comes out is indistinguishable from one
-- somebody typed in the app: same times, same status, and nothing recording
-- that a terminal recognised their face at a named door.
--
-- That difference is the whole value of the hardware. "Punched in at 09:02" is
-- somebody saying they arrived; "face recognised at Main Gate at 09:02" is a
-- machine saying so. A timesheet that shows them identically cannot answer the
-- one question a dispute turns on.
--
-- WHY THESE COLUMNS AND NOT A JOIN
--
-- The information is already in biometric_events, and reading it from there
-- would need a join on every attendance row on every screen -- for a value that
-- never changes once written. It would also tie the register to the event log:
-- events are evidence and may one day be archived or pruned, and an attendance
-- row must still be able to say where its punch came from after that happens.
--
-- WHY NOT REUSE in_location_name
--
-- There is no such column. The location shown on a timesheet today is derived
-- at read time from the punch's coordinates, matched against the offices on
-- record. A wall-mounted terminal sends no coordinates, so that derivation
-- yields nothing for these punches however real the location is. The area name
-- is a better answer anyway -- a named door rather than a point that happens to
-- fall inside a radius.
--
-- in_device and out_device are NOT added: they already exist, holding the
-- browser a face punch was made from. A terminal's name answers the same
-- question ("which device recorded this") and goes in the same place.
--
-- ADDITIVE. Four nullable columns on attendance. Null everywhere until a
-- biometric punch writes one, which is exactly right for every row that came
-- from the app.
-- ============================================================

ALTER TABLE attendance
    -- FACE | FINGERPRINT | FACE_FINGERPRINT, as biometric_events.auth_method
    -- reads it. Null for a punch that did not come from a terminal, which is
    -- the honest answer rather than a default that would claim a face check
    -- nobody performed.
    ADD COLUMN in_auth_method VARCHAR(24) NULL
        COMMENT 'How the punch-in was authenticated at a biometric terminal. Null for app punches.',
    ADD COLUMN out_auth_method VARCHAR(24) NULL
        COMMENT 'How the punch-out was authenticated at a biometric terminal. Null for app punches.',

    -- Hikvision's areaName from the pushed event: "Main Gate", "Second Floor
    -- Entry". 128 to match biometric_events.area_name, so a value that fits
    -- there cannot be truncated on the way here.
    ADD COLUMN in_area_name VARCHAR(128) NULL
        COMMENT 'The terminal area the punch-in was made at, as Hikvision names it.',
    ADD COLUMN out_area_name VARCHAR(128) NULL
        COMMENT 'The terminal area the punch-out was made at.';

-- No index. These are read as part of a row already being fetched by
-- (user_id, work_date) and are never a search key; an index on them would cost
-- writes on every punch and be used by nothing.

-- Verification -- all must hold:
--   SELECT COUNT(*) FROM attendance;                    -- unchanged
--   SELECT COUNT(*) FROM attendance WHERE in_auth_method IS NOT NULL;  -- 0 at first
--   SHOW COLUMNS FROM attendance LIKE '%auth_method%';  -- two rows
