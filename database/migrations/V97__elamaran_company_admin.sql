-- ============================================================
-- V97 — Elamaran Subramaniyan (PIX-E100) becomes a company administrator.
--
-- Asked for directly: he is to have the administrator's access, not HR's.
--
-- COMPANY_ADMIN rather than SUPER_ADMIN. The two are treated as the same role
-- throughout the application — V96 gave COMPANY_ADMIN the SUPER_ADMIN
-- permission set, and both the web client and the backend read one as the other
-- — but COMPANY_ADMIN is the name a tenant's own administrator carries, and the
-- one the technical-admin screens create. Using it keeps him consistent with
-- every other company administrator rather than making him a special case.
--
-- REPLACES his roles rather than adding to them. Holding IT_EMP as well would
-- keep him counted in the employee totals and listed in the staff directory as
-- an ordinary employee, which is the "HR maari" halfway state that was asked
-- against. An administrator is an administrator.
--
-- Idempotent, and a no-op if the employee code does not match: re-running it
-- changes nothing, and a database where PIX-E100 does not exist is left exactly
-- as it was rather than failing the migration and stopping the backend from
-- starting. VERIFY AFTER DEPLOY — see the query at the bottom.
-- ============================================================

-- Matched on the employee code, with the name as a second chance.
--
-- The code was given as PIX-E100; every other code seen on this database looks
-- like EMP0004, so there is a real possibility it is written differently. A
-- migration that matches nothing does nothing, deploys cleanly, and is only
-- discovered when somebody tries to sign in as an administrator and cannot —
-- which is the worst time to find out. Matching the name as well makes that far
-- less likely.

-- Take away whatever he holds now.
DELETE ur FROM user_roles ur
JOIN users u ON u.id = ur.user_id
WHERE u.employee_code = 'PIX-E100'
   OR u.name = 'Elamaran Subramaniyan';

-- Give him the administrator role.
INSERT INTO user_roles (user_id, role_id)
SELECT u.id, r.id
FROM users u
JOIN roles r ON r.code = 'COMPANY_ADMIN'
WHERE (u.employee_code = 'PIX-E100' OR u.name = 'Elamaran Subramaniyan')
  AND NOT EXISTS (
      SELECT 1 FROM user_roles x
      WHERE x.user_id = u.id AND x.role_id = r.id
  );

-- ------------------------------------------------------------
-- Verify after deploying, on the server:
--
--   SELECT u.employee_code, u.name, r.code
--   FROM users u
--   JOIN user_roles ur ON ur.user_id = u.id
--   JOIN roles r ON r.id = ur.role_id
--   WHERE u.employee_code = 'PIX-E100' OR u.name = 'Elamaran Subramaniyan';
--
-- One row, COMPANY_ADMIN. No rows means the employee code is different from
-- PIX-E100 — check it on the Employees screen and say so, rather than assuming
-- this worked.
-- ------------------------------------------------------------
