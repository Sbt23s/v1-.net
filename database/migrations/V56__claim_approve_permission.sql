-- CLAIM_APPROVE: view every expense claim and approve or reject it.
-- Granted to HR; admins already reach it through USER_MANAGE.
INSERT INTO permissions (code, name)
SELECT 'CLAIM_APPROVE', 'Approve or reject expense claims'
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'CLAIM_APPROVE');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code = 'CLAIM_APPROVE'
WHERE r.code IN ('IT_MGR', 'IT_HR')
  AND NOT EXISTS (
      SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );
