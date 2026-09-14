-- ============================================================
-- V146 - Days where the arrival and the departure were the wrong way round.
--
-- The exported attendance sheet for 07 September carried this:
--
--   PIX-E025   07 Sep IN  6:48 PM   07 Sep OUT  8:48 AM
--   PIX-E008   07 Sep IN  9:18 PM   07 Sep OUT  8:45 AM
--
-- Nobody arrived at a quarter past nine at night. The cause was in
-- PunchDirection, which honoured Hikvision's IntelliInfo.attendanceStatus: on
-- that day the terminal reported "off work" (2) on people walking in and
-- "on work" (1) on people leaving, so the morning punch was filed as the
-- departure and the evening punch became the arrival. The rule has been changed
-- to read the timestamps instead -- earliest punch is the arrival, latest is the
-- departure -- because a terminal's rule configuration is not an observation and
-- the timestamps are never wrong about their own order.
--
-- That fixes punches from now on. It does not fix the rows already written, and
-- those rows are not merely odd to look at: late_minutes was computed against an
-- evening "arrival", and worked_minutes came out of a punch-out that preceded
-- the punch-in. Both reach a payslip.
--
-- WHY THE EVENTS CAN BE TRUSTED TO REPAIR IT
--
-- biometric_events holds every punch verbatim, with occur_time exactly as the
-- terminal reported it. Only the in/out interpretation was wrong; the times
-- themselves were never touched. So the repair is to re-derive each affected day
-- from its own events: MIN(occur_time) is the arrival, MAX(occur_time) is the
-- departure.
--
-- SCOPE IS DELIBERATELY NARROW
--
-- Only rows where punch_out_at is at or before punch_in_at -- the reversal made
-- visible. A day whose two punches are in a sensible order is left alone even if
-- attendanceStatus had a hand in it, because there is nothing observable to
-- correct and rewriting a correct row risks more than it gains.
--
-- Only rows that came from the terminal: a day with at least two successful
-- biometric events. A reversed pair typed in by hand is a different problem with
-- a different answer, and this migration must not silently overwrite somebody's
-- manual correction.
--
-- auth_result = 1 only. A failed authentication is a stranger at the door or a
-- broken enrolment, not somebody arriving.
-- ============================================================

-- The days to repair, and what the events say they should be.
CREATE TEMPORARY TABLE tmp_punch_repair AS
SELECT a.id                   AS attendance_id,
       MIN(e.occur_time)      AS real_in,
       MAX(e.occur_time)      AS real_out
FROM attendance a
JOIN biometric_events e
      ON  e.user_id = a.user_id
      AND DATE(e.occur_time) = a.work_date
      AND e.auth_result = 1
WHERE a.punch_in_at IS NOT NULL
  AND a.punch_out_at IS NOT NULL
  AND a.punch_out_at <= a.punch_in_at
GROUP BY a.id
HAVING COUNT(*) >= 2
   AND MIN(e.occur_time) < MAX(e.occur_time);

-- The times, put back the way round they happened.
UPDATE attendance a
JOIN tmp_punch_repair t ON t.attendance_id = a.id
SET a.punch_in_at  = t.real_in,
    a.punch_out_at = t.real_out;

-- The duration, which was computed from the reversed pair. Recomputed here
-- rather than left to the application, because nothing re-reads a day that has
-- already been processed.
UPDATE attendance a
JOIN tmp_punch_repair t ON t.attendance_id = a.id
SET a.worked_minutes = TIMESTAMPDIFF(MINUTE, a.punch_in_at, a.punch_out_at)
WHERE a.punch_in_at IS NOT NULL
  AND a.punch_out_at IS NOT NULL;

/*
 * Lateness is NOT recomputed here, and that is a decision rather than an
 * omission. It depends on the shift assigned to the day and on the grace period
 * in application configuration, neither of which SQL should be guessing at --
 * a migration that invents a shift start would write lateness onto days that
 * were never late. What this migration can say honestly is that the figure was
 * derived from an arrival time that has now changed, so it is cleared rather
 * than left carrying a number nobody can defend. The column is NOT NULL, so
 * cleared means zero.
 *
 * Zero is the safe direction: it credits the employee rather than charging them
 * for lateness this system computed against an evening it had mistaken for a
 * morning. Whoever reviews the month can mark a genuine late arrival; nobody
 * would think to look for a deduction that was invented.
 */
UPDATE attendance a
JOIN tmp_punch_repair t ON t.attendance_id = a.id
SET a.late_minutes = 0,
    a.is_late = 0;

/*
 * The same reversal, on days whose events are no longer available to re-derive
 * from.
 *
 * biometric_events is the better source and is used above wherever it can be.
 * But a reversed row whose events were never stored -- the event arrived before
 * the table existed, or the punch was matched to the employee afterwards and
 * the event carries no user_id -- would otherwise be left exactly as it is,
 * which is the state this migration exists to end.
 *
 * For those, no derivation is needed. A reversal did not damage the times; it
 * put them in the wrong columns. Both values are real punches, and the earlier
 * of the two is the arrival by the same rule the application now applies. So
 * they are swapped.
 *
 * Guarded to rows that are still reversed, so nothing the block above already
 * corrected is touched a second time.
 */
-- The corrected values are computed into the temporary table first, and the
-- UPDATE only copies them across. Assigning columns from each other in a single
-- SET depends on the order the engine applies them, and getting that wrong
-- writes a negative duration silently; this way the arithmetic cannot see a
-- half-updated row.
CREATE TEMPORARY TABLE tmp_punch_swap AS
SELECT a.id           AS attendance_id,
       a.punch_out_at AS real_in,
       a.punch_in_at  AS real_out
FROM attendance a
WHERE a.punch_in_at IS NOT NULL
  AND a.punch_out_at IS NOT NULL
  AND a.punch_out_at < a.punch_in_at;

UPDATE attendance a
JOIN tmp_punch_swap s ON s.attendance_id = a.id
SET a.punch_in_at    = s.real_in,
    a.punch_out_at   = s.real_out,
    a.worked_minutes = TIMESTAMPDIFF(MINUTE, s.real_in, s.real_out),
    a.late_minutes   = 0,
    a.is_late        = 0;

DROP TEMPORARY TABLE tmp_punch_swap;
DROP TEMPORARY TABLE tmp_punch_repair;

-- Verification -- all must hold:
--   SELECT COUNT(*) FROM attendance WHERE punch_out_at <= punch_in_at;
--   -- 0, or only rows with no biometric events behind them
--
--   SELECT work_date, punch_in_at, punch_out_at FROM attendance a
--     JOIN users u ON u.id = a.user_id
--    WHERE u.employee_code IN ('PIX-E025','PIX-E008')
--      AND a.work_date = '2026-09-07';
--   -- morning in, evening out
