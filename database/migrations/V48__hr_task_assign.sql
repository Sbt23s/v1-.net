-- Let HR (IT_MGR) assign tasks (restricted in code to Team Leaders only).
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code = 'TASK_ASSIGN'
WHERE r.code IN ('IT_MGR', 'IT_HR')
  AND NOT EXISTS (
      SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );
