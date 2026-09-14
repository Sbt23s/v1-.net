-- ============================================================
-- V90 — The dedicated HR login, restored.
--
-- An account with the username "hr" existed and people used it; it is not in this
-- database. Five imported employees carry the HR role, but none of them is the
-- shared HR login somebody reaches for.
--
-- Recreated as a migration rather than by hand so it exists in every environment
-- and cannot be lost again by restoring a dump that predates it.
--
-- ONE THING WORTH SAYING PLAINLY: the password is six characters, and the portal's
-- own rule for a new account is eight or more. It is set here because it is the
-- password that already existed and people know it — creating it through the
-- ordinary endpoint would have been refused. Change it to something longer when
-- convenient; HR can do that from its own profile, and the portal will show the
-- new one to the admin as it does for every other account.
-- ============================================================

-- Only if it is genuinely missing. Re-running must never overwrite a password
-- somebody has since changed.
INSERT INTO users (
    employee_code, name, username, password_hash,
    dob, gender, industry, profile_status, enabled,
    date_of_joining, created_by, designation_title, department_title
)
SELECT
    'HR0001', 'HR', 'hr',
    -- BCrypt of Hr@123, cost 10 — the same cost as every seeded account, so the
    -- login path treats this one no differently.
    '$2b$10$maGZYMMucINa5cNCoeOVjuB6i17m3aQ9zX1E2J783pXezkcWsKTi.',
    '1990-01-01', 'F', 'IT', 'ACTIVE', 1,
    CURDATE(), 'system', 'Human Resources', 'Human Resources'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM users WHERE username = 'hr');

-- The HR role. IT_MGR is what the portal stores for HR — it is displayed as
-- IT_HR everywhere a role code is shown.
INSERT INTO user_roles (user_id, role_id)
SELECT u.id, r.id
FROM users u
JOIN roles r ON r.code = 'IT_MGR'
WHERE u.username = 'hr'
  AND NOT EXISTS (
      SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id AND ur.role_id = r.id
  );
