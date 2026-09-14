-- ============================================================
-- COMPLAINT_MANAGE: review and respond to complaints and needs.
-- HR (IT_MGR / IT_HR) never held USER_MANAGE, so the complaints
-- queue was invisible to them and they could not be chosen as the
-- person a complaint is addressed to. Admins keep reaching it
-- through USER_MANAGE.
-- ============================================================

INSERT INTO permissions (code, name)
SELECT 'COMPLAINT_MANAGE', 'Review and respond to complaints'
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'COMPLAINT_MANAGE');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code = 'COMPLAINT_MANAGE'
WHERE r.code IN ('IT_MGR', 'IT_HR', 'CV_HR')
  AND NOT EXISTS (
      SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );
