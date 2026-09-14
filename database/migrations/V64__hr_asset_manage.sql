-- ============================================================
-- HR registers and allocates equipment, so it needs ASSET_MANAGE.
-- Until now only asset managers and facilities admins held it, and
-- the super admin reached it by holding everything — which left the
-- inventory unmanageable by the people whose job it is.
-- ============================================================

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code = 'ASSET_MANAGE'
WHERE r.code IN ('IT_MGR', 'IT_HR', 'CV_HR')
  AND NOT EXISTS (
      SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );
