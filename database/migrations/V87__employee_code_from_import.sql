-- ============================================================
-- V87 — Give people back their real employee ID.
--
-- The Excel import puts the sheet's Emp Id into the username and nothing else,
-- so the backend generated a fresh sequential code: somebody who is PIX-E057
-- everywhere in the company appeared throughout the portal as EMP0061. The real
-- ID was in the account the whole time, in the username, just not where anybody
-- looks for it.
--
-- This copies it into employee_code for exactly the rows where that is safe:
--   * the username looks like a real company ID (PIX-…)
--   * the current code is one of the generated EMP#### ones
--   * uppercasing the username does not collide with a code already in use
--
-- Anybody added by hand, and anybody whose code was set deliberately, is left
-- alone. Nothing else in the schema stores the code — payroll, attendance and
-- everything else key off the user id — so this only changes what is displayed,
-- which is the thing that was wrong.
-- ============================================================

UPDATE users u
JOIN (
    SELECT id, UPPER(username) AS real_code
    FROM users
    WHERE username IS NOT NULL
      AND username REGEXP '^[Pp][Ii][Xx][-_]?[A-Za-z]?[0-9]+$'
      AND employee_code REGEXP '^EMP[0-9]+$'
) pick ON pick.id = u.id
SET u.employee_code = pick.real_code
WHERE NOT EXISTS (
    SELECT 1 FROM (SELECT id, employee_code FROM users) other
    WHERE other.employee_code = pick.real_code AND other.id <> u.id
);
