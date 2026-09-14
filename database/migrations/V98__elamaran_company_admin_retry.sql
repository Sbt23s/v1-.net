-- ============================================================
-- V98 — Elamaran Subramaniyan: administrator access, second attempt.
--
-- V97 did the same thing matched on employee_code = 'PIX-E100' with the exact
-- name as a fallback. If neither matched, it ran perfectly, deployed cleanly and
-- changed nothing — and Flyway never runs a migration twice, so V97 will not try
-- again no matter how many times the backend restarts. Hence a new one.
--
-- This matches the surname on its own. "Elamaran" is distinctive enough that a
-- LIKE is safe here in a way it would not be for "Kumar", and it survives the
-- things that defeat an exact match: a middle name, a double space, a trailing
-- space, or the employee code being written differently from PIX-E100.
--
-- Idempotent. Safe to run against a database where V97 already worked — it ends
-- in exactly the same state.
--
-- COMPANY_ADMIN, not SUPER_ADMIN. The two are one role throughout this
-- application: V96 gave COMPANY_ADMIN the SUPER_ADMIN permission set, and both
-- the backend and the web client read one as the other. COMPANY_ADMIN is the
-- name a company's own administrator carries and the one the technical-admin
-- screens create, so he stays consistent with every other administrator instead
-- of being a special case.
--
-- Roles are REPLACED, not added to. Keeping IT_EMP alongside would leave him
-- counted in the employee totals and listed as ordinary staff — the half-HR,
-- half-admin state that was explicitly not wanted.
-- ============================================================

DELETE ur FROM user_roles ur
JOIN users u ON u.id = ur.user_id
WHERE u.employee_code = 'PIX-E100'
   OR u.name LIKE '%Elamaran%';

INSERT INTO user_roles (user_id, role_id)
SELECT u.id, r.id
FROM users u
JOIN roles r ON r.code = 'COMPANY_ADMIN'
WHERE (u.employee_code = 'PIX-E100' OR u.name LIKE '%Elamaran%')
  AND NOT EXISTS (
      SELECT 1 FROM user_roles x
      WHERE x.user_id = u.id AND x.role_id = r.id
  );

-- ------------------------------------------------------------
-- Verify after deploying:
--
--   SELECT u.id, u.employee_code, u.name, r.code
--   FROM users u
--   JOIN user_roles ur ON ur.user_id = u.id
--   JOIN roles r ON r.id = ur.role_id
--   WHERE u.name LIKE '%Elamaran%';
--
-- One row, COMPANY_ADMIN. Still no rows means nobody in this database has
-- "Elamaran" in their name at all — check the spelling on the Employees screen,
-- because at that point the name itself is what is wrong.
-- ------------------------------------------------------------
