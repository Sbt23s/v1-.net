-- ============================================================
-- CALENDAR_MANAGE: add and remove holidays / calendar events.
-- HR (IT_MGR) never held ORG_MANAGE, so it could not manage the
-- calendar even though that is its job. Admins keep reaching it
-- through ORG_MANAGE. Team Leaders get neither.
-- ============================================================

INSERT INTO permissions (code, name)
SELECT 'CALENDAR_MANAGE', 'Add and remove calendar events'
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'CALENDAR_MANAGE');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code = 'CALENDAR_MANAGE'
WHERE r.code IN ('IT_MGR', 'IT_HR', 'CV_HR')
  AND NOT EXISTS (
      SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );
