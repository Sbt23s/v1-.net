-- ============================================================
-- V8 — Seed data: roles, permissions, master data, demo users.
-- Demo login password for ALL seeded users is:  Test1234@
-- (BCrypt hash below). Login uses Aadhaar + password.
-- ============================================================

-- ---- Roles ----
INSERT INTO roles (code, name, industry, description) VALUES
 ('SUPER_ADMIN','Platform Super Admin','BOTH','Full configuration access'),
 ('IT_EMP','IT Employee','IT','Self-service employee'),
 ('IT_HR','IT HR / Payroll Manager','IT','HR & payroll administration'),
 ('IT_MGR','IT Manager / Team Lead','IT','Team approvals & appraisals'),
 ('IT_FIN','Finance Officer','IT','Payroll & expense approvals'),
 ('IT_CEO','CEO','IT','Executive dashboards & policy'),
 ('IT_AST','IT Asset Manager','IT','IT asset lifecycle'),
 ('CV_EMP','Civil Site Employee','CIVIL','Site self-service'),
 ('CV_HR','Civil HR Manager','CIVIL','Labour compliance & workforce'),
 ('CV_ADM','Civil / Facilities Admin','CIVIL','Sites & facilities'),
 ('CV_AST','Civil Asset Manager','CIVIL','Machinery & materials'),
 ('CV_SUP','Civil Supervisor','CIVIL','Site approvals & safety');

-- ---- Permissions ----
INSERT INTO permissions (code, name) VALUES
 ('USER_MANAGE','Manage employees'),
 ('LEAVE_APPLY','Apply for leave'),
 ('LEAVE_APPROVE','Approve leave'),
 ('ATTENDANCE_SELF','Mark own attendance'),
 ('ATTENDANCE_TEAM','View team attendance'),
 ('PAYROLL_VIEW','View own payslips'),
 ('PAYROLL_RUN','Run payroll'),
 ('PAYROLL_APPROVE','Approve payroll'),
 ('ASSET_MANAGE','Manage assets'),
 ('HELPDESK_RAISE','Raise tickets'),
 ('HELPDESK_AGENT','Resolve tickets'),
 ('REPORT_VIEW','View reports'),
 ('DASHBOARD_EXEC','View executive dashboard'),
 ('ORG_MANAGE','Manage organisation master data');

-- ---- Role → permission grants (concise but representative) ----
-- Employees: self-service
INSERT INTO role_permissions (role_id, permission_id)
 SELECT r.id, p.id FROM roles r JOIN permissions p
 ON p.code IN ('LEAVE_APPLY','ATTENDANCE_SELF','PAYROLL_VIEW','HELPDESK_RAISE')
 WHERE r.code IN ('IT_EMP','CV_EMP');
-- Managers / supervisors: + approvals & team views
INSERT INTO role_permissions (role_id, permission_id)
 SELECT r.id, p.id FROM roles r JOIN permissions p
 ON p.code IN ('LEAVE_APPLY','LEAVE_APPROVE','ATTENDANCE_SELF','ATTENDANCE_TEAM','PAYROLL_VIEW','HELPDESK_RAISE','REPORT_VIEW')
 WHERE r.code IN ('IT_MGR','CV_SUP');
-- HR: + user mgmt, payroll run, org, reports
INSERT INTO role_permissions (role_id, permission_id)
 SELECT r.id, p.id FROM roles r JOIN permissions p
 ON p.code IN ('USER_MANAGE','LEAVE_APPROVE','PAYROLL_RUN','REPORT_VIEW','ORG_MANAGE','ATTENDANCE_TEAM')
 WHERE r.code IN ('IT_HR','CV_HR');
-- Finance: payroll approve + reports
INSERT INTO role_permissions (role_id, permission_id)
 SELECT r.id, p.id FROM roles r JOIN permissions p
 ON p.code IN ('PAYROLL_APPROVE','REPORT_VIEW')
 WHERE r.code = 'IT_FIN';
-- CEO: exec dashboard + reports
INSERT INTO role_permissions (role_id, permission_id)
 SELECT r.id, p.id FROM roles r JOIN permissions p
 ON p.code IN ('DASHBOARD_EXEC','REPORT_VIEW')
 WHERE r.code = 'IT_CEO';
-- Asset managers
INSERT INTO role_permissions (role_id, permission_id)
 SELECT r.id, p.id FROM roles r JOIN permissions p
 ON p.code IN ('ASSET_MANAGE','HELPDESK_AGENT')
 WHERE r.code IN ('IT_AST','CV_AST');
-- Facilities admin: assets + helpdesk agent + org
INSERT INTO role_permissions (role_id, permission_id)
 SELECT r.id, p.id FROM roles r JOIN permissions p
 ON p.code IN ('ASSET_MANAGE','HELPDESK_AGENT','ORG_MANAGE')
 WHERE r.code = 'CV_ADM';
-- Super admin: everything
INSERT INTO role_permissions (role_id, permission_id)
 SELECT r.id, p.id FROM roles r CROSS JOIN permissions p WHERE r.code = 'SUPER_ADMIN';

-- ---- Master data ----
INSERT INTO blood_groups (name) VALUES ('A+'),('A-'),('B+'),('B-'),('O+'),('O-'),('AB+'),('AB-');
INSERT INTO departments (name, code) VALUES
 ('Engineering','ENG'),('Human Resources','HR'),('Finance','FIN'),
 ('Operations','OPS'),('Civil Projects','CIVIL'),('IT Support','ITS');
INSERT INTO designations (name, code) VALUES
 ('Software Engineer','SE'),('Senior Engineer','SSE'),('Team Lead','TL'),
 ('HR Executive','HRE'),('Site Engineer','SITE'),('Project Manager','PM'),('Accountant','ACC');
INSERT INTO employment_statuses (name) VALUES ('Permanent'),('Probation'),('Contract'),('Intern'),('Daily Wage');
INSERT INTO positions (name) VALUES ('Junior'),('Mid'),('Senior'),('Lead'),('Manager');
INSERT INTO office_locations (name, address, latitude, longitude, geofence_radius_metres) VALUES
 ('Coimbatore HQ','Peelamedu, Coimbatore', 11.0297000, 77.0270000, 200),
 ('Chennai Office','T Nagar, Chennai', 13.0418000, 80.2341000, 200);
INSERT INTO shifts (name, start_time, end_time, is_night) VALUES
 ('General','09:00:00','18:00:00',0),('Morning','06:00:00','14:00:00',0),('Night','22:00:00','06:00:00',1);
INSERT INTO sites (name, code, address, latitude, longitude, geofence_radius_metres, project_start) VALUES
 ('Metro Phase-2 Site','SITE-MP2','OMR, Chennai', 12.8996000, 80.2209000, 300, '2026-01-15'),
 ('Highway NH-44 Site','SITE-NH44','Salem', 11.6643000, 78.1460000, 500, '2025-11-01');

INSERT INTO leave_types (name, code, max_days_per_year, carry_forward, encashable, gender_restriction, allow_past_dates, accrual_type, min_notice_days) VALUES
 ('Casual Leave','CL',12,0,0,NULL,0,'ANNUAL',1),
 ('Sick Leave','SL',12,0,0,NULL,1,'ANNUAL',0),
 ('Earned Leave','EL',18,1,1,NULL,0,'MONTHLY',3),
 ('Compensatory Off','COMP',0,0,0,NULL,0,'MANUAL',1),
 ('Maternity Leave','MAT',182,0,0,'F',0,'MANUAL',15),
 ('Paternity Leave','PAT',15,0,0,'M',0,'MANUAL',7),
 ('Loss of Pay','LOP',0,0,0,NULL,1,'MANUAL',0);

INSERT INTO announcements (title, body, created_by) VALUES
 ('Welcome to the new HR Portal','The new portal is live. Explore attendance, leave and payslips.','admin'),
 ('Annual appraisal cycle opens 1 July','Self-assessments are due by 15 July.','admin'),
 ('Independence Day holiday','Office closed on 15 August.','admin');

-- ---- Demo users (password = Test1234@) ----
-- BCrypt hash of "Test1234@":
SET @pw := '$2b$10$mnvJJYUPSzzyJ6U1AYsEMuQn2p.bj9Z7TAniqCD6U6clmDQcLLc/K';

INSERT INTO users (employee_code,name,dob,gender,aadhar,phone,email,password_hash,department_id,designation_id,office_location_id,industry,profile_status,enabled,date_of_joining,created_by)
VALUES
 ('EMP0001','Arun Kumar','1995-05-11','M','123456789022','9876543233','arun@pixoustech.com',@pw,1,1,1,'IT','ACTIVE',1,'2024-01-10','admin'),
 ('EMP0002','Divya Ramesh','1993-08-21','F','123456789033','9876543244','divya@pixoustech.com',@pw,2,4,1,'IT','ACTIVE',1,'2023-06-01','admin'),
 ('EMP0003','Karthik Subramani','1988-02-15','M','123456789044','9876543255','karthik@pixoustech.com',@pw,1,3,1,'IT','ACTIVE',1,'2021-03-15','admin'),
 ('EMP0004','Priya Natarajan','1990-11-30','F','123456789055','9876543266','priya@pixoustech.com',@pw,3,7,1,'IT','ACTIVE',1,'2022-09-01','admin'),
 ('EMP0005','Rajesh Civil','1985-07-07','M','123456789066','9876543277','rajesh@pixoustech.com',@pw,5,5,2,'CIVIL','ACTIVE',1,'2020-01-01','admin'),
 ('ADM0001','System Admin','1990-01-01','M','999999999999','9000000000','admin@pixoustech.com',@pw,2,3,1,'IT','ACTIVE',1,'2019-01-01','admin');

-- Reporting line: EMP0001/0002 report to EMP0003 (manager)
UPDATE users SET reporting_manager_id = (SELECT id FROM (SELECT id FROM users WHERE employee_code='EMP0003') t)
 WHERE employee_code IN ('EMP0001','EMP0002');

-- ---- Role assignments ----
INSERT INTO user_roles (user_id, role_id)
 SELECT u.id, r.id FROM users u JOIN roles r ON r.code='IT_EMP' WHERE u.employee_code IN ('EMP0001','EMP0002');
INSERT INTO user_roles (user_id, role_id)
 SELECT u.id, r.id FROM users u JOIN roles r ON r.code='IT_MGR' WHERE u.employee_code='EMP0003';
INSERT INTO user_roles (user_id, role_id)
 SELECT u.id, r.id FROM users u JOIN roles r ON r.code='IT_HR' WHERE u.employee_code='EMP0004';
INSERT INTO user_roles (user_id, role_id)
 SELECT u.id, r.id FROM users u JOIN roles r ON r.code='CV_SUP' WHERE u.employee_code='EMP0005';
INSERT INTO user_roles (user_id, role_id)
 SELECT u.id, r.id FROM users u JOIN roles r ON r.code='SUPER_ADMIN' WHERE u.employee_code='ADM0001';

-- ---- Sample salary structures + leave balances for the current year ----
INSERT INTO salary_structures (user_id, basic_salary, hra, allowances, pt_amount, effective_from)
 SELECT id, 35000, 14000, 6000, 200, '2025-04-01' FROM users WHERE employee_code IN ('EMP0001','EMP0002','EMP0003','EMP0004','EMP0005');

INSERT INTO leave_balances (user_id, leave_type_id, year, allocated, used)
 SELECT u.id, lt.id, YEAR(CURDATE()), lt.max_days_per_year, 0
 FROM users u CROSS JOIN leave_types lt
 WHERE u.employee_code IN ('EMP0001','EMP0002','EMP0003','EMP0005')
   AND lt.code IN ('CL','SL','EL');

-- ---- A couple of sample assets ----
INSERT INTO assets (asset_code, category, asset_type, brand, model, serial_number, purchase_date, purchase_cost, warranty_expiry, status) VALUES
 ('AST-IT-0001','IT','Laptop','Dell','Latitude 5440','DL5440-001','2024-02-01',75000,'2027-02-01','IN_STOCK'),
 ('AST-IT-0002','IT','Monitor','LG','27UL550','LG27-002','2024-02-01',22000,'2026-02-01','IN_STOCK'),
 ('AST-MC-0001','MACHINERY','Excavator','JCB','JS220','JCB-220-01','2023-05-10',4500000,NULL,'AVAILABLE');
