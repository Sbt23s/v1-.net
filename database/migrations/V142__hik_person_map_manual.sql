-- ============================================================
-- V142 - A terminal identity somebody matched by hand.
--
-- V140 assumed the join between a Hikvision person and an employee would be
-- their shared employee number: set the same code on both sides and the sync
-- finds it. That is how the integration is meant to work, and on the live
-- account it cannot.
--
-- Hikvision refuses to change an employee number once a person exists. POST
-- /persons/update answers OPEN000010 "param valid error, validated failed
-- argument [personCode]", and §5.8.6 of the V2.15.0 guide says it plainly:
-- "The employee No. cannot be edited." The terminal was set up years ago with
-- codes like "001" and "039"; this portal uses "PIX-E001" and "PIX-E039". They
-- describe the same 25 people and no automatic rule can safely join them --
-- "001" also matches "ADM0001", which is a different person entirely.
--
-- So the join has to be a decision somebody makes, and this column records
-- that it was made. The sync then leaves those rows alone: without the flag,
-- the next hourly run would look at "001", find no employee with that code,
-- and count a deliberately mapped person as unmatched -- undoing the work
-- every hour, silently.
--
-- WHY NOT WRITE THE PORTAL'S CODE ONTO THE MAPPING INSTEAD
--
-- Because it would be a lie about where the value came from. person_code holds
-- what Hikvision holds, so that a later sync can still recognise the person and
-- so an administrator comparing the two sides sees the truth. Overwriting it
-- with "PIX-E001" would make the mapping self-consistent and the terminal
-- unrecognisable.
--
-- ADDITIVE. One column, defaulting to 0, which is what every row written by the
-- automatic sync is.
-- ============================================================

ALTER TABLE hik_person_map
    ADD COLUMN manual TINYINT(1) NOT NULL DEFAULT 0
        COMMENT 'A person matched this identity to this employee by hand. The sync will not revisit it.',
    ADD COLUMN mapped_by VARCHAR(60) NULL
        COMMENT 'Who made the manual match, for the audit trail the sync cannot provide.',
    ADD COLUMN mapped_at DATETIME NULL
        COMMENT 'When the manual match was made.';

-- No index: `manual` is read as part of a row already fetched by
-- hik_person_id, never searched on.

-- Verification -- all must hold:
--   SHOW COLUMNS FROM hik_person_map LIKE 'manual';       -- one row, default 0
--   SELECT COUNT(*) FROM hik_person_map WHERE manual = 1; -- 0 before any are made
