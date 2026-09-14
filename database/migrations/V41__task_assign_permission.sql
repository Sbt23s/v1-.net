-- TASK_ASSIGN permission: lets a Team Leader assign tasks to their own team.
INSERT INTO permissions (code, name)
SELECT 'TASK_ASSIGN', 'Assign tasks to team members'
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'TASK_ASSIGN');

-- Grant it to Team Leader. (Admin/HR already assign via USER_MANAGE.)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code = 'TASK_ASSIGN'
WHERE r.code = 'IT_TL'
  AND NOT EXISTS (
      SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );
