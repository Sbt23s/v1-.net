-- ============================================================
-- V75 — the three Infra logins.
--
-- Infra is run apart from Digital: an Infra Admin over the whole
-- side, and two supervisors with a team each.
--
--   PIX-I001  infra.admin   CV_ADM   Infra Admin, both teams
--   PIX-I002  supervisor1   CV_SUP   PMC Workers
--   PIX-I003  supervisor2   CV_SUP   Construction Workers
--
-- Passwords are BCrypt, generated for this migration and handed over
-- separately. They should be changed on first sign-in.
--
-- Digital is untouched: nothing here reads or writes an IT record.
--
-- Safe to run twice: each insert finds the username already present
-- and adds nothing. created_at / updated_at carry their defaults.
-- ============================================================

INSERT INTO users (employee_code, username, name, email, password_hash,
                   industry, employment_type, date_of_joining,
                   designation_title, department_title, position_title,
                   profile_status, enabled)
SELECT 'PIX-I001', 'infra.admin', 'Infra Admin', 'infra.admin@pixoustech.com',
       '$2a$10$1uMpBCtU9aUCZhSb8ga0p.YY0quNAFO.2/D1r0CNDbjdR2u642W6O',
       'CIVIL', 'PERMANENT', CURDATE(),
       NULL, 'Civil Projects', 'Admin',
       'ACTIVE', 1
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM users WHERE username = 'infra.admin');

INSERT INTO users (employee_code, username, name, email, password_hash,
                   industry, employment_type, date_of_joining,
                   designation_title, department_title, position_title,
                   profile_status, enabled)
SELECT 'PIX-I002', 'supervisor1', 'Supervisor 1', 'supervisor1@pixoustech.com',
       '$2a$10$xRtVP9ZlGCFnQsZ.7gtKXeZEnbu0tb34b1iAE/gI41d/ovVI/qgf2',
       'CIVIL', 'PERMANENT', CURDATE(),
       'PMC Workers', 'Civil Projects', 'Supervisor',
       'ACTIVE', 1
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM users WHERE username = 'supervisor1');

INSERT INTO users (employee_code, username, name, email, password_hash,
                   industry, employment_type, date_of_joining,
                   designation_title, department_title, position_title,
                   profile_status, enabled)
SELECT 'PIX-I003', 'supervisor2', 'Supervisor 2', 'supervisor2@pixoustech.com',
       '$2a$10$Ck12ynisaYsmkzgmqgQG5.WaTH9QilExGFLn1sQ1w5am7C4q76IC2',
       'CIVIL', 'PERMANENT', CURDATE(),
       'Construction Workers', 'Civil Projects', 'Supervisor',
       'ACTIVE', 1
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM users WHERE username = 'supervisor2');

-- ---- Roles ----
-- CV_ADM for the Infra Admin, CV_SUP for the two supervisors. Both were
-- seeded in V8, so this only joins people to them.
INSERT INTO user_roles (user_id, role_id)
SELECT u.id, r.id
FROM users u
JOIN roles r ON r.code = 'CV_ADM'
WHERE u.username = 'infra.admin'
  AND NOT EXISTS (
      SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id AND ur.role_id = r.id);

INSERT INTO user_roles (user_id, role_id)
SELECT u.id, r.id
FROM users u
JOIN roles r ON r.code = 'CV_SUP'
WHERE u.username IN ('supervisor1', 'supervisor2')
  AND NOT EXISTS (
      SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id AND ur.role_id = r.id);

-- ---- The two Infra teams the supervisors lead ----
-- Seeded in V26; re-stated so this migration stands on its own if a team was
-- removed in between.
INSERT INTO designations (name, code, industry, active)
SELECT 'PMC Workers', 'PMC_WRK', 'CIVIL', 1
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM designations WHERE name = 'PMC Workers');

INSERT INTO designations (name, code, industry, active)
SELECT 'Construction Workers', 'CON_WRK', 'CIVIL', 1
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM designations WHERE name = 'Construction Workers');

-- Point each supervisor at their team by id as well as by title, so the
-- directory and the team pages agree on who leads what.
UPDATE users u
JOIN designations d ON d.name = 'PMC Workers'
SET u.designation_id = d.id
WHERE u.username = 'supervisor1' AND u.designation_id IS NULL;

UPDATE users u
JOIN designations d ON d.name = 'Construction Workers'
SET u.designation_id = d.id
WHERE u.username = 'supervisor2' AND u.designation_id IS NULL;
