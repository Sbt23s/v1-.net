-- ============================================================
-- V94 — Give every tenant-owned table a company_id, and fill it in.
--
-- WHAT THIS DOES NOT DO: change any behaviour. No code reads these columns yet.
-- Adding a nullable column and backfilling it cannot hide a row or break a query,
-- which is the point of doing it as its own step. The filters that will use these
-- columns are switched on afterwards, one area at a time, each verified.
--
-- WHY IT IS NEEDED: a company's records are currently only kept apart where they
-- hang off `users`, which does carry company_id and is filtered. Anything with its
-- own table and no such column is shared by everyone. Proven by test: an HR
-- account moved to company 1 could read company 4's holidays and leave types.
--
-- THE BACKFILL: every existing row belongs to the single company that exists
-- today. That id is looked up rather than hard-coded, so this is correct whatever
-- the row happens to be numbered.
--
-- DELIBERATELY LEFT ALONE:
--   blood_groups, employment_statuses, positions  reference data, the same
--                                                 everywhere; scoping them would
--                                                 leave a new company with empty
--                                                 dropdowns
--   permissions, roles, role_permissions          the permission model is global;
--                                                 Role already filters on
--                                                 "company_id OR IS NULL"
--   user_roles, refresh_tokens, *_reads, *_votes  reached only through a parent
--                                                 that is itself scoped
--   companies, company_modules, technical_admins  these describe tenants; they
--                                                 cannot belong to one
--   flyway_schema_history                         not ours
-- ============================================================

SET @tenant := (SELECT id FROM companies ORDER BY id LIMIT 1);

-- ---- per-company configuration -------------------------------------------
ALTER TABLE holidays            ADD COLUMN company_id BIGINT NULL;
ALTER TABLE leave_types         ADD COLUMN company_id BIGINT NULL;
ALTER TABLE departments         ADD COLUMN company_id BIGINT NULL;
ALTER TABLE designations        ADD COLUMN company_id BIGINT NULL;
ALTER TABLE office_locations    ADD COLUMN company_id BIGINT NULL;
ALTER TABLE shifts              ADD COLUMN company_id BIGINT NULL;
ALTER TABLE sites               ADD COLUMN company_id BIGINT NULL;
ALTER TABLE system_settings     ADD COLUMN company_id BIGINT NULL;
ALTER TABLE announcements       ADD COLUMN company_id BIGINT NULL;
ALTER TABLE company_events      ADD COLUMN company_id BIGINT NULL;

UPDATE holidays         SET company_id = @tenant WHERE company_id IS NULL;
UPDATE leave_types      SET company_id = @tenant WHERE company_id IS NULL;
UPDATE departments      SET company_id = @tenant WHERE company_id IS NULL;
UPDATE designations     SET company_id = @tenant WHERE company_id IS NULL;
UPDATE office_locations SET company_id = @tenant WHERE company_id IS NULL;
UPDATE shifts           SET company_id = @tenant WHERE company_id IS NULL;
UPDATE sites            SET company_id = @tenant WHERE company_id IS NULL;
UPDATE system_settings  SET company_id = @tenant WHERE company_id IS NULL;
UPDATE announcements    SET company_id = @tenant WHERE company_id IS NULL;
UPDATE company_events   SET company_id = @tenant WHERE company_id IS NULL;

-- ---- what people do day to day -------------------------------------------
ALTER TABLE attendance          ADD COLUMN company_id BIGINT NULL;
ALTER TABLE leave_requests      ADD COLUMN company_id BIGINT NULL;
ALTER TABLE leave_balances      ADD COLUMN company_id BIGINT NULL;
ALTER TABLE tasks               ADD COLUMN company_id BIGINT NULL;
ALTER TABLE tickets             ADD COLUMN company_id BIGINT NULL;
ALTER TABLE ticket_comments     ADD COLUMN company_id BIGINT NULL;
ALTER TABLE complaints_needs    ADD COLUMN company_id BIGINT NULL;
ALTER TABLE work_reports        ADD COLUMN company_id BIGINT NULL;
ALTER TABLE safety_incidents    ADD COLUMN company_id BIGINT NULL;

UPDATE attendance       SET company_id = @tenant WHERE company_id IS NULL;
UPDATE leave_requests   SET company_id = @tenant WHERE company_id IS NULL;
UPDATE leave_balances   SET company_id = @tenant WHERE company_id IS NULL;
UPDATE tasks            SET company_id = @tenant WHERE company_id IS NULL;
UPDATE tickets          SET company_id = @tenant WHERE company_id IS NULL;
UPDATE ticket_comments  SET company_id = @tenant WHERE company_id IS NULL;
UPDATE complaints_needs SET company_id = @tenant WHERE company_id IS NULL;
UPDATE work_reports     SET company_id = @tenant WHERE company_id IS NULL;
UPDATE safety_incidents SET company_id = @tenant WHERE company_id IS NULL;

-- ---- money ----------------------------------------------------------------
ALTER TABLE payslips            ADD COLUMN company_id BIGINT NULL;
ALTER TABLE payroll_runs        ADD COLUMN company_id BIGINT NULL;
ALTER TABLE salary_structures   ADD COLUMN company_id BIGINT NULL;
ALTER TABLE expense_claims      ADD COLUMN company_id BIGINT NULL;

UPDATE payslips          SET company_id = @tenant WHERE company_id IS NULL;
UPDATE payroll_runs      SET company_id = @tenant WHERE company_id IS NULL;
UPDATE salary_structures SET company_id = @tenant WHERE company_id IS NULL;
UPDATE expense_claims    SET company_id = @tenant WHERE company_id IS NULL;

-- ---- things and paperwork -------------------------------------------------
ALTER TABLE assets              ADD COLUMN company_id BIGINT NULL;
ALTER TABLE asset_allocations   ADD COLUMN company_id BIGINT NULL;
ALTER TABLE asset_maintenance   ADD COLUMN company_id BIGINT NULL;
ALTER TABLE employee_documents  ADD COLUMN company_id BIGINT NULL;
ALTER TABLE bank_details        ADD COLUMN company_id BIGINT NULL;
ALTER TABLE educations          ADD COLUMN company_id BIGINT NULL;
ALTER TABLE experiences         ADD COLUMN company_id BIGINT NULL;
ALTER TABLE family_members      ADD COLUMN company_id BIGINT NULL;
ALTER TABLE employee_imports    ADD COLUMN company_id BIGINT NULL;

UPDATE assets             SET company_id = @tenant WHERE company_id IS NULL;
UPDATE asset_allocations  SET company_id = @tenant WHERE company_id IS NULL;
UPDATE asset_maintenance  SET company_id = @tenant WHERE company_id IS NULL;
UPDATE employee_documents SET company_id = @tenant WHERE company_id IS NULL;
UPDATE bank_details       SET company_id = @tenant WHERE company_id IS NULL;
UPDATE educations         SET company_id = @tenant WHERE company_id IS NULL;
UPDATE experiences        SET company_id = @tenant WHERE company_id IS NULL;
UPDATE family_members     SET company_id = @tenant WHERE company_id IS NULL;
UPDATE employee_imports   SET company_id = @tenant WHERE company_id IS NULL;

-- ---- talking to each other ------------------------------------------------
ALTER TABLE communities         ADD COLUMN company_id BIGINT NULL;
ALTER TABLE community_messages  ADD COLUMN company_id BIGINT NULL;
ALTER TABLE notifications       ADD COLUMN company_id BIGINT NULL;
ALTER TABLE audit_log           ADD COLUMN company_id BIGINT NULL;
ALTER TABLE login_history       ADD COLUMN company_id BIGINT NULL;
ALTER TABLE chatbot_knowledge   ADD COLUMN company_id BIGINT NULL;

UPDATE communities        SET company_id = @tenant WHERE company_id IS NULL;
UPDATE community_messages SET company_id = @tenant WHERE company_id IS NULL;
UPDATE notifications      SET company_id = @tenant WHERE company_id IS NULL;
UPDATE audit_log          SET company_id = @tenant WHERE company_id IS NULL;
UPDATE login_history      SET company_id = @tenant WHERE company_id IS NULL;
UPDATE chatbot_knowledge  SET company_id = @tenant WHERE company_id IS NULL;

-- Indexed because every scoped query will filter on it, and an unindexed
-- company_id turns each of those into a full scan once there is more than one
-- tenant. Added only where rows accumulate.
CREATE INDEX idx_attendance_company  ON attendance(company_id);
CREATE INDEX idx_leave_req_company   ON leave_requests(company_id);
CREATE INDEX idx_tasks_company       ON tasks(company_id);
CREATE INDEX idx_tickets_company     ON tickets(company_id);
CREATE INDEX idx_payslips_company    ON payslips(company_id);
CREATE INDEX idx_notif_company       ON notifications(company_id);
CREATE INDEX idx_audit_company       ON audit_log(company_id);
CREATE INDEX idx_commsg_company      ON community_messages(company_id);
