-- ============================================================
-- EMPLOYEE_MANAGE: add an employee, edit their profile and reset
-- their login — the parts of the Employees page HR needs.
--
-- Deliberately NOT USER_MANAGE: dozens of checks read that as "is
-- an admin" (tasks are admin-view-only, payslips, calendar, claims,
-- complaints, the Supports overview), so granting it would silently
-- turn HR into an admin everywhere. Offboarding and deleting an
-- employee stay with admins.
-- ============================================================

INSERT INTO permissions (code, name)
SELECT 'EMPLOYEE_MANAGE', 'Add and edit employee accounts'
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'EMPLOYEE_MANAGE');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code = 'EMPLOYEE_MANAGE'
WHERE r.code IN ('IT_MGR', 'IT_HR', 'CV_HR')
  AND NOT EXISTS (
      SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );
