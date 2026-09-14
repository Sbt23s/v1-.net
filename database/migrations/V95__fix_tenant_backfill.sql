-- ============================================================
-- V95 — Correct the company V94 stamped everything with.
--
-- V94 chose the tenant like this:
--
--     SET @tenant := (SELECT id FROM companies ORDER BY id LIMIT 1);
--
-- which is the LOWEST company id, not the company the data belongs to. On this
-- installation that picked company 1 (Sethu Technologies) while every one of the
-- 62 users sits in company 4 (Pixous Technologies). Holidays, leave types,
-- departments and the rest were therefore labelled as another company's.
--
-- The consequence was not a leak — it was the opposite, and worse. Once those
-- rows are scoped, the real company stops seeing its own holidays and its own
-- leave types, and nobody can apply for leave. Caught by the diagnostic that
-- printed "caller company=1 rows=7 firstRowCompany=1": the filter was doing its
-- job on data that had been mislabelled.
--
-- V94 is left as it is rather than edited, so that anywhere it has already run
-- keeps a truthful history and this correction is visible as its own step.
--
-- THE RULE HERE: the owner is whichever company the people belong to. Users are
-- the one table that carried company_id correctly all along, from account
-- creation, so they are the authority.
--
-- GUARDED: this only runs while exactly one company owns users. The moment there
-- is a second real tenant, re-stamping every row would be destructive, so it
-- stops instead. That is why this is a one-time correction and not a pattern to
-- copy.
-- ============================================================

-- The company the workforce actually belongs to.
SET @owner := (
    SELECT company_id FROM users
    WHERE company_id IS NOT NULL
    GROUP BY company_id
    ORDER BY COUNT(*) DESC
    LIMIT 1
);

-- How many companies own users. Anything other than 1 and the correction is
-- skipped: with several tenants there is no single right answer, and guessing
-- would move one company's records into another.
SET @tenant_count := (
    SELECT COUNT(DISTINCT company_id) FROM users WHERE company_id IS NOT NULL
);

SET @safe := (@owner IS NOT NULL AND @tenant_count = 1);

-- Each statement re-stamps only where it is wrong, and only when it is safe.
-- With @safe false every WHERE is unsatisfiable and the migration is a no-op.

UPDATE holidays            SET company_id = @owner WHERE @safe AND company_id <> @owner;
UPDATE leave_types         SET company_id = @owner WHERE @safe AND company_id <> @owner;
UPDATE departments         SET company_id = @owner WHERE @safe AND company_id <> @owner;
UPDATE designations        SET company_id = @owner WHERE @safe AND company_id <> @owner;
UPDATE office_locations    SET company_id = @owner WHERE @safe AND company_id <> @owner;
UPDATE shifts              SET company_id = @owner WHERE @safe AND company_id <> @owner;
UPDATE sites               SET company_id = @owner WHERE @safe AND company_id <> @owner;
UPDATE system_settings     SET company_id = @owner WHERE @safe AND company_id <> @owner;
UPDATE announcements       SET company_id = @owner WHERE @safe AND company_id <> @owner;
UPDATE company_events      SET company_id = @owner WHERE @safe AND company_id <> @owner;

UPDATE attendance          SET company_id = @owner WHERE @safe AND company_id <> @owner;
UPDATE leave_requests      SET company_id = @owner WHERE @safe AND company_id <> @owner;
UPDATE leave_balances      SET company_id = @owner WHERE @safe AND company_id <> @owner;
UPDATE tasks               SET company_id = @owner WHERE @safe AND company_id <> @owner;
UPDATE tickets             SET company_id = @owner WHERE @safe AND company_id <> @owner;
UPDATE ticket_comments     SET company_id = @owner WHERE @safe AND company_id <> @owner;
UPDATE complaints_needs    SET company_id = @owner WHERE @safe AND company_id <> @owner;
UPDATE work_reports        SET company_id = @owner WHERE @safe AND company_id <> @owner;
UPDATE safety_incidents    SET company_id = @owner WHERE @safe AND company_id <> @owner;

UPDATE payslips            SET company_id = @owner WHERE @safe AND company_id <> @owner;
UPDATE payroll_runs        SET company_id = @owner WHERE @safe AND company_id <> @owner;
UPDATE salary_structures   SET company_id = @owner WHERE @safe AND company_id <> @owner;
UPDATE expense_claims      SET company_id = @owner WHERE @safe AND company_id <> @owner;

UPDATE assets              SET company_id = @owner WHERE @safe AND company_id <> @owner;
UPDATE asset_allocations   SET company_id = @owner WHERE @safe AND company_id <> @owner;
UPDATE asset_maintenance   SET company_id = @owner WHERE @safe AND company_id <> @owner;
UPDATE employee_documents  SET company_id = @owner WHERE @safe AND company_id <> @owner;
UPDATE bank_details        SET company_id = @owner WHERE @safe AND company_id <> @owner;
UPDATE educations          SET company_id = @owner WHERE @safe AND company_id <> @owner;
UPDATE experiences         SET company_id = @owner WHERE @safe AND company_id <> @owner;
UPDATE family_members      SET company_id = @owner WHERE @safe AND company_id <> @owner;
UPDATE employee_imports    SET company_id = @owner WHERE @safe AND company_id <> @owner;

UPDATE communities         SET company_id = @owner WHERE @safe AND company_id <> @owner;
UPDATE community_messages  SET company_id = @owner WHERE @safe AND company_id <> @owner;
UPDATE notifications       SET company_id = @owner WHERE @safe AND company_id <> @owner;
UPDATE audit_log           SET company_id = @owner WHERE @safe AND company_id <> @owner;
UPDATE login_history       SET company_id = @owner WHERE @safe AND company_id <> @owner;
UPDATE chatbot_knowledge   SET company_id = @owner WHERE @safe AND company_id <> @owner;
