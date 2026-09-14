-- ============================================================
-- V150 - Daily attendance digests that counted people who never punch.
--
-- The digest named every enabled account with no punch-in as absent, and three
-- of those accounts are the super administrator, the system administrator and
-- the company head. None of them takes attendance, so all three appeared every
-- working day:
--
--   Today: 52 absent, 2 on leave
--   Absent (no leave applied): System Admin (ADM0001), Preethi Dhanalakshmi ...
--
-- DailyAbsenceNotifier no longer counts them. The rows already sent still do,
-- and they are what HR and the CTO are reading.
--
-- WHY THESE ARE DELETED RATHER THAN REWRITTEN
--
-- Every other repair in this project has edited the text in place, because the
-- text was the only record of the fact. Not here. The count is in the title and
-- the names are in the body, so correcting one means recounting the other, and
-- the body is a truncated list -- "and 26 more" -- from which the real number
-- cannot be recovered. A migration that removed three names and left "52"
-- standing would produce a digest that contradicts itself.
--
-- Nothing is lost by dropping them. A digest is a same-day nudge, not a record:
-- the attendance rows it was derived from are untouched, and the register,
-- the exports and the reports all still answer who was in on any given day.
-- These rows are the announcement, not the fact.
--
-- SCOPE
--
-- ATTENDANCE_DIGEST only, and only those that name one of the three. A digest
-- from a day when all three happened to be omitted is already correct and is
-- left alone -- which also makes this safe to re-run and safe after the fixed
-- job has been writing correct ones.
-- ============================================================

DELETE FROM notifications
WHERE type = 'ATTENDANCE_DIGEST'
  AND (body LIKE '%(ADM0001)%'
    OR body LIKE '%(SADM001)%'
    OR body LIKE '%(PIX-E100)%');

-- Verification -- all must hold:
--   SELECT COUNT(*) FROM notifications
--    WHERE type = 'ATTENDANCE_DIGEST'
--      AND (body LIKE '%(ADM0001)%' OR body LIKE '%(SADM001)%'
--           OR body LIKE '%(PIX-E100)%');
--   -- 0
--
--   SELECT COUNT(*) FROM attendance;   -- unchanged by this migration
