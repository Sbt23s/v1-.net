-- ============================================================
-- V149 - Lateness recounted from the office start, with no grace.
--
-- application.properties set app.attendance.late-grace-minutes=15 while
-- application.yml claimed zero. .properties wins in Spring Boot, so fifteen
-- minutes was the value in force and the yml was decorative -- which is why the
-- register looked wrong in a way nobody could find in the file they read:
--
--   08 Sep, punch in 09:21  ->  late_minutes 6    (should be 21)
--   07 Sep, punch in 09:09  ->  late_minutes 0    (should be 9)
--
-- Every employee was being forgiven a quarter of an hour that nobody had
-- granted, on both routes -- the app and the biometric terminal share this
-- arithmetic -- every day. Both files now say zero: 09:00 is on time, 09:01 is
-- one minute late.
--
-- That fixes punches from here on. The rows already written still carry the
-- discounted figure, and those are what the register, the exports and the
-- payroll deductions read.
--
-- HOW THE START TIME IS FOUND, ROW BY ROW
--
-- The same way AttendanceService.startTimeFor does it: the row's own shift when
-- it has one and that shift has a start time, otherwise 09:00 -- the default
-- behind app.attendance.office-start. Recomputing every row against a flat
-- 09:00 would have been simpler and wrong for anybody on a shift.
--
-- WHAT IS NOT TOUCHED
--
-- Rows with no punch-in. There is no arrival to be late for, and a day somebody
-- was absent or on leave must not acquire a lateness figure from this.
--
-- Early arrivals stay at zero: GREATEST(0, ...) floors it, so somebody who came
-- in at 08:40 is not credited with negative lateness.
--
-- is_late is derived from the recounted minutes rather than left alone, because
-- the two are one fact stored twice and V146 has already shown what happens
-- when they drift.
-- ============================================================

UPDATE attendance a
LEFT JOIN shifts s ON s.id = a.shift_id
SET a.late_minutes = GREATEST(0, TIMESTAMPDIFF(
        MINUTE,
        TIMESTAMP(a.work_date, COALESCE(s.start_time, '09:00:00')),
        a.punch_in_at))
WHERE a.punch_in_at IS NOT NULL;

UPDATE attendance
SET is_late = (late_minutes > 0)
WHERE punch_in_at IS NOT NULL;

-- Verification -- all must hold:
--   SELECT work_date, punch_in_at, late_minutes, is_late FROM attendance a
--     JOIN users u ON u.id = a.user_id
--    WHERE u.employee_code = 'PIX-E057' AND a.work_date >= '2026-09-01'
--    ORDER BY a.work_date;
--   -- 08 Sep 09:21 -> 21 minutes, late
--   -- 07 Sep 09:09 -> 9 minutes, late
--   -- 03 Sep 08:56 -> 0 minutes, not late
--
--   SELECT COUNT(*) FROM attendance WHERE punch_in_at IS NULL AND late_minutes > 0;
--   -- 0: no lateness on a day with no arrival
