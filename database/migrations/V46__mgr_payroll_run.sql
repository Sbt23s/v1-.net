-- Let the HR role (IT_MGR) generate payslips: grant PAYROLL_RUN.
-- IT_MGR already has PAYROLL_VIEW; this adds generate/salary/request access.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code = 'PAYROLL_RUN'
WHERE r.code = 'IT_MGR'
  AND NOT EXISTS (
      SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );
