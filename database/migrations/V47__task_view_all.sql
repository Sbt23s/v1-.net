-- TASK_VIEW_ALL: view every employee/team's tasks and export them (read-only),
-- without the ability to assign or delete. Granted to HR roles.
INSERT INTO permissions (code, name)
SELECT 'TASK_VIEW_ALL', 'View all employee tasks and export'
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'TASK_VIEW_ALL');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code = 'TASK_VIEW_ALL'
WHERE r.code IN ('IT_MGR', 'IT_HR')
  AND NOT EXISTS (
      SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );
