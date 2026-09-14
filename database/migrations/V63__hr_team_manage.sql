-- ============================================================
-- TEAM_MANAGE: create and delete teams (designations).
--
-- HR runs the team structure but holds neither USER_MANAGE nor
-- ORG_MANAGE, so Add Team and Delete Team were refused. Setting a
-- team lead and moving someone out of a team already go through
-- PUT /users/{id}, which HR reaches via EMPLOYEE_MANAGE, so this is
-- the only piece it was missing.
-- ============================================================

INSERT INTO permissions (code, name)
SELECT 'TEAM_MANAGE', 'Create and delete teams'
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'TEAM_MANAGE');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code = 'TEAM_MANAGE'
WHERE r.code IN ('IT_MGR', 'IT_HR', 'CV_HR')
  AND NOT EXISTS (
      SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );
