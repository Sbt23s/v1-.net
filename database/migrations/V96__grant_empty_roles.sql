-- ============================================================
-- V96 — Give the five empty roles their permissions.
--
-- COMPANY_ADMIN, HR_MANAGER, TEAM_LEAD, EMPLOYEE and BOARD_ADMIN were created by
-- the application on 11 Aug 2026 and never granted anything: zero rows each in
-- role_permissions. They are also exactly the five the technical-admin "create
-- user" form offers, so an account made as HR_MANAGER received no HR access at
-- all — it behaved like a bare employee. Confirmed by probing 24 endpoints as
-- each role: those four columns were identical to a self-service user.
--
-- Each empty role is given the permission set of the working role it names. The
-- mapping was written up in REQUIREMENTS_SPECIFICATION.md (GAP-01) before being
-- applied:
--
--   COMPANY_ADMIN  <- SUPER_ADMIN     the company's own top-level administrator
--   HR_MANAGER     <- IT_HR           HR and payroll
--   TEAM_LEAD      <- IT_TL           team visibility and approvals
--   EMPLOYEE       <- IT_EMP          self-service
--   BOARD_ADMIN    <- read-only       reports and the executive dashboard
--
-- ADDITIVE ONLY. Rows are inserted, never deleted, and only where the pairing is
-- missing, so running this twice changes nothing and no existing role loses
-- anything. Copying from the live sets rather than listing permission codes means
-- the grants stay correct if those sets are edited later.
--
-- BOARD_ADMIN is deliberately not a mirror: it is meant to look, not act, so it
-- gets REPORT_VIEW and DASHBOARD_EXEC and nothing that changes data.
-- ============================================================

INSERT INTO role_permissions (role_id, permission_id)
SELECT tgt.id, rp.permission_id
FROM roles tgt
JOIN roles src            ON src.code = 'SUPER_ADMIN'
JOIN role_permissions rp  ON rp.role_id = src.id
WHERE tgt.code = 'COMPANY_ADMIN'
  AND NOT EXISTS (SELECT 1 FROM role_permissions x
                  WHERE x.role_id = tgt.id AND x.permission_id = rp.permission_id);

INSERT INTO role_permissions (role_id, permission_id)
SELECT tgt.id, rp.permission_id
FROM roles tgt
JOIN roles src            ON src.code = 'IT_HR'
JOIN role_permissions rp  ON rp.role_id = src.id
WHERE tgt.code = 'HR_MANAGER'
  AND NOT EXISTS (SELECT 1 FROM role_permissions x
                  WHERE x.role_id = tgt.id AND x.permission_id = rp.permission_id);

INSERT INTO role_permissions (role_id, permission_id)
SELECT tgt.id, rp.permission_id
FROM roles tgt
JOIN roles src            ON src.code = 'IT_TL'
JOIN role_permissions rp  ON rp.role_id = src.id
WHERE tgt.code = 'TEAM_LEAD'
  AND NOT EXISTS (SELECT 1 FROM role_permissions x
                  WHERE x.role_id = tgt.id AND x.permission_id = rp.permission_id);

INSERT INTO role_permissions (role_id, permission_id)
SELECT tgt.id, rp.permission_id
FROM roles tgt
JOIN roles src            ON src.code = 'IT_EMP'
JOIN role_permissions rp  ON rp.role_id = src.id
WHERE tgt.code = 'EMPLOYEE'
  AND NOT EXISTS (SELECT 1 FROM role_permissions x
                  WHERE x.role_id = tgt.id AND x.permission_id = rp.permission_id);

-- Look, do not touch.
INSERT INTO role_permissions (role_id, permission_id)
SELECT tgt.id, p.id
FROM roles tgt
JOIN permissions p ON p.code IN ('REPORT_VIEW', 'DASHBOARD_EXEC')
WHERE tgt.code = 'BOARD_ADMIN'
  AND NOT EXISTS (SELECT 1 FROM role_permissions x
                  WHERE x.role_id = tgt.id AND x.permission_id = p.id);
