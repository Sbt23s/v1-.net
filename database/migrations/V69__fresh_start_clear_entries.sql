-- ============================================================
--  Fresh start: clears the entries made while testing, keeps
--  every person and everything that describes them.
--
--  Runs ONCE, automatically, on the next deploy. Flyway records it
--  in its history, so it can never run a second time -- a punch or a
--  claim entered after this deploy is safe.
--
--  The deploy takes a mysqldump of the whole database before Flyway
--  runs (deploy/pre-deploy.sh), so there is a copy of everything as
--  it was, under ~/backups/hr-predeploy-<timestamp>.sql.gz.
--
--  On a brand-new database this deletes nothing, because there is
--  nothing there yet.
--
--  CLEARED -- the day-to-day records:
--    attendance, leave and permission requests, support tickets and
--    their replies, complaints, expense claims, tasks, work reports,
--    assets and their allocations, payslips and payroll runs,
--    notifications, chat messages, announcements, safety incidents,
--    performance goals and reviews, onboarding checklists, login
--    history, the audit log and any pending OTPs.
--
--  KEPT -- everybody, and everything they are:
--    users and their logins, roles and permissions, teams,
--    departments, designations, positions, office locations,
--    branches, companies, sites, shifts, employment statuses, bank
--    details, education, experience, family members, skills,
--    employee documents, salary structures, investment declarations,
--    offboarding records, leave types and their entitlements,
--    holidays, chat channels and who is in them, system settings and
--    the assistant's knowledge base.
--
--  Signed-in sessions are left alone, so nobody is thrown out by the
--  deploy that runs this.
-- ============================================================

-- ---- Support desk: replies before the tickets they belong to ----
DELETE FROM ticket_comments;
DELETE FROM tickets;

-- ---- Complaints ----
DELETE FROM complaints_needs;

-- ---- Expense claims ----
DELETE FROM ta_expenses;
DELETE FROM expense_claims;

-- ---- Tasks and work logs ----
DELETE FROM tasks;
DELETE FROM work_reports;

-- ---- Attendance ----
DELETE FROM attendance;

-- ---- Leave and permission ----
DELETE FROM leave_requests;
DELETE FROM permission_requests;
-- The allotment stays. Only what the deleted requests had consumed goes,
-- so nobody loses the days they were given.
UPDATE leave_balances SET used = 0;

-- ---- Assets: allocations and service history before the assets ----
DELETE FROM asset_allocations;
DELETE FROM asset_maintenance;
DELETE FROM assets;
DELETE FROM software_licenses;

-- ---- Payroll: payslips before the runs that produced them ----
DELETE FROM payslips;
DELETE FROM payslip_requests;
DELETE FROM payroll_runs;

-- ---- Onboarding progress: tasks before their checklists ----
DELETE FROM onboarding_tasks;
DELETE FROM onboarding_checklists;

-- ---- Safety and performance ----
DELETE FROM safety_incidents;
DELETE FROM performance_goals;
DELETE FROM performance_reviews;

-- ---- Chat: the messages, not the channels or their members ----
DELETE FROM community_messages;
DELETE FROM announcements;

-- ---- Notifications and trails ----
DELETE FROM notifications;
DELETE FROM login_history;
DELETE FROM audit_log;
DELETE FROM otp_codes;

-- ---- Numbering starts again at one ----
-- So the first real claim is CLM-...-000001 and the first ticket
-- TKT-...-00001, rather than carrying on from the test data.
ALTER TABLE ticket_comments       AUTO_INCREMENT = 1;
ALTER TABLE tickets               AUTO_INCREMENT = 1;
ALTER TABLE complaints_needs      AUTO_INCREMENT = 1;
ALTER TABLE ta_expenses           AUTO_INCREMENT = 1;
ALTER TABLE expense_claims        AUTO_INCREMENT = 1;
ALTER TABLE tasks                 AUTO_INCREMENT = 1;
ALTER TABLE work_reports          AUTO_INCREMENT = 1;
ALTER TABLE attendance            AUTO_INCREMENT = 1;
ALTER TABLE leave_requests        AUTO_INCREMENT = 1;
ALTER TABLE permission_requests   AUTO_INCREMENT = 1;
ALTER TABLE asset_allocations     AUTO_INCREMENT = 1;
ALTER TABLE asset_maintenance     AUTO_INCREMENT = 1;
ALTER TABLE assets                AUTO_INCREMENT = 1;
ALTER TABLE software_licenses     AUTO_INCREMENT = 1;
ALTER TABLE payslips              AUTO_INCREMENT = 1;
ALTER TABLE payslip_requests      AUTO_INCREMENT = 1;
ALTER TABLE payroll_runs          AUTO_INCREMENT = 1;
ALTER TABLE onboarding_tasks      AUTO_INCREMENT = 1;
ALTER TABLE onboarding_checklists AUTO_INCREMENT = 1;
ALTER TABLE safety_incidents      AUTO_INCREMENT = 1;
ALTER TABLE performance_goals     AUTO_INCREMENT = 1;
ALTER TABLE performance_reviews   AUTO_INCREMENT = 1;
ALTER TABLE community_messages    AUTO_INCREMENT = 1;
ALTER TABLE announcements         AUTO_INCREMENT = 1;
ALTER TABLE notifications         AUTO_INCREMENT = 1;
ALTER TABLE login_history         AUTO_INCREMENT = 1;
ALTER TABLE audit_log             AUTO_INCREMENT = 1;
