-- Dedicated Team Leader role, separate from Manager (IT_MGR). A Team Leader
-- sees their team's attendance and approves team leave, but has no payroll/HR
-- powers.
INSERT INTO roles (code, name, industry, description)
SELECT 'IT_TL', 'Team Leader', 'IT', 'Team Leader — team attendance view and team leave approval'
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE code = 'IT_TL');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p
  ON p.code IN ('LEAVE_APPLY', 'LEAVE_APPROVE', 'ATTENDANCE_SELF', 'ATTENDANCE_TEAM', 'REPORT_VIEW', 'HELPDESK_RAISE')
WHERE r.code = 'IT_TL'
  AND NOT EXISTS (
      SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );
