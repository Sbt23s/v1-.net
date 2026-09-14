-- ============================================================
-- Elamaran Subramaniyam (PIX-E100) gets the same access as the
-- system admin: the SUPER_ADMIN role, which V8 cross-joins to
-- every permission, so nothing has to be listed here one by one.
--
-- He is also the single approver for HR's own leave — that part is
-- enforced in LeaveService by employee code, not by role, so no
-- other admin can stand in.
--
-- Existing roles are kept; this adds SUPER_ADMIN alongside them, so
-- his own team and designation still work as before.
-- ============================================================

INSERT INTO user_roles (user_id, role_id)
SELECT u.id, r.id
FROM users u
JOIN roles r ON r.code = 'SUPER_ADMIN'
WHERE u.employee_code = 'PIX-E100'
  AND NOT EXISTS (
      SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id AND ur.role_id = r.id
  );
