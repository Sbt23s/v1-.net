-- ============================================================
-- V73 — COMMUNITY_MANAGE: create groups and manage who is in them.
--
-- Communities was admin-only. HR runs the same thing for their own
-- groups, so they need the section and the actions behind it.
--
-- Held by the admin and by every HR role. The company head is
-- recognised by employee code in CommunityService, the way he is
-- elsewhere, so this holds whatever roles his account carries.
-- ============================================================

INSERT INTO permissions (code, name)
SELECT 'COMMUNITY_MANAGE', 'Create community groups and manage members'
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'COMMUNITY_MANAGE');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code = 'COMMUNITY_MANAGE'
WHERE r.code IN ('SUPER_ADMIN', 'IT_MGR', 'IT_HR', 'CV_HR')
  AND NOT EXISTS (
      SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );
