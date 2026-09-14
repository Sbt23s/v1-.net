-- ============================================================
-- V99 — Update Elamaran Subramaniyan (PIX-E100) to CEO title
-- and assign Full Admin access (COMPANY_ADMIN & SUPER_ADMIN).
-- ============================================================

UPDATE users
SET name = 'CEO',
    designation_title = 'CEO'
WHERE employee_code = 'PIX-E100' OR name LIKE '%Elamaran%' OR name = 'Elamaaran Subramaniyan';

DELETE ur FROM user_roles ur
JOIN users u ON u.id = ur.user_id
WHERE u.employee_code = 'PIX-E100' OR u.name = 'CEO' OR u.name LIKE '%Elamaran%';

INSERT INTO user_roles (user_id, role_id)
SELECT u.id, r.id
FROM users u
JOIN roles r ON r.code IN ('COMPANY_ADMIN', 'SUPER_ADMIN')
WHERE (u.employee_code = 'PIX-E100' OR u.name = 'CEO' OR u.name LIKE '%Elamaran%')
  AND NOT EXISTS (
      SELECT 1 FROM user_roles x
      WHERE x.user_id = u.id AND x.role_id = r.id
  );
