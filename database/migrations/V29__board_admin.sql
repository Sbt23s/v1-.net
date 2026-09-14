-- Board Admin: two extra logins that behave EXACTLY like the Super Admin
-- (they carry the SUPER_ADMIN role, so every permission/approval works the
-- same), but are labelled "Board Admin" in the UI via the BOARD_ADMIN marker
-- role. Idempotent so it is safe to re-run.

-- 1) Display-marker role. Real powers come from SUPER_ADMIN.
INSERT INTO roles (code, name, industry, description)
SELECT 'BOARD_ADMIN', 'Board Admin', 'BOTH', 'Board-level admin (same access as Super Admin)'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE code = 'BOARD_ADMIN');

-- 2) The two board-admin accounts.
-- BCrypt($2b$10$) of "gokila@123"
INSERT INTO users (employee_code, username, name, email, password_hash, industry, profile_status, enabled, date_of_joining, created_by)
SELECT 'BADM001', 'gokila', 'Gokila', 'gokila@pixoustech.com',
       '$2b$10$eY/M6M83Fy6cHX7YKOEZX.kO8Dumuha905GuUkq.SK8JzUjCB8Ky2',
       'IT', 'ACTIVE', 1, '2019-01-01', 'admin'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM users WHERE username = 'gokila');

-- BCrypt($2b$10$) of "maaran@123"
INSERT INTO users (employee_code, username, name, email, password_hash, industry, profile_status, enabled, date_of_joining, created_by)
SELECT 'BADM002', 'maaran', 'Maaran', 'maaran@pixoustech.com',
       '$2b$10$lo92e2eqqsOVmZcMd6jtte3F1KAIdy5gaJuO.J3BvNQO4.6qsfnZG',
       'IT', 'ACTIVE', 1, '2019-01-01', 'admin'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM users WHERE username = 'maaran');

-- 3) Give both accounts SUPER_ADMIN (full access) + BOARD_ADMIN (label).
INSERT INTO user_roles (user_id, role_id)
SELECT u.id, r.id
FROM users u
JOIN roles r ON r.code IN ('SUPER_ADMIN', 'BOARD_ADMIN')
WHERE u.username IN ('gokila', 'maaran')
  AND NOT EXISTS (
        SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id AND ur.role_id = r.id
  );
