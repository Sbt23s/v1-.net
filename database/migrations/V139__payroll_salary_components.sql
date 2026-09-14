-- ============================================================
-- V139 - The salary components a payslip has to show, and who a payslip went to.
--
-- NUMBERED 139, NOT 109
--
-- This started as V109, which is the next free number on this branch. It is
-- not free everywhere: the employee-portal-v1 lineage already has a V109
-- ("super admin configuration") and runs up to V138. A database migrated along
-- that line would have seen this file as a version it had already applied and
-- skipped it entirely.
--
-- That failure is silent, and worse than a plain error. The application sets
-- spring.flyway.repair-on-migrate=true with validate-on-migrate=false and runs
-- repair() before every migrate (see FlywayConfig), so instead of reporting a
-- checksum mismatch Flyway rewrote the stored row to match this file, reported
-- "Schema is up to date. No migration necessary", and applied nothing. The
-- columns below were absent while the history claimed they were present, and
-- startup then died on schema validation:
--
--     Schema-validation: missing column [advance_deduction] in table [payslips]
--
-- Found by pointing the built jar at a copy of the v1 database and letting
-- Flyway run, rather than by applying this file by hand -- applying it by hand
-- is what hides the problem. 139 is past every version in either lineage.
--
-- salary_structures holds basic_salary, hra and one combined `allowances`, with
-- pf as a percentage. A payslip is expected to itemise conveyance, special
-- allowance, bonus and overtime separately -- an employee reading "Allowances
-- 10,000" cannot check it against anything, and an auditor cannot either.
--
-- The existing columns are kept and keep their meaning. `allowances` stays, and
-- everything that reads it keeps working; the new columns default to zero, so
-- every one of the five structures already stored behaves exactly as it does
-- today until somebody edits it.
--
-- WHY NOT REPLACE `allowances`
--
-- Splitting it would mean deciding, for five existing rows, how much of a lump
-- sum was conveyance and how much was special allowance. Nobody knows, and a
-- guess written into payroll is worse than a combined figure that is at least
-- true. It stays as "other allowance" in effect, and the new fields are added
-- alongside for structures configured from now on.
--
-- PAYSLIP DELIVERY
--
-- PayslipService already emails a payslip with its PDF attached, and records
-- nothing about it. So "was September sent to this person?" has no answer, and
-- a failed send is invisible -- which is the one case somebody needs to know
-- about. Four columns fix that, and the status defaults to NOT_SENT, which is
-- the truth for every payslip generated so far.
--
-- ONE ACTIVE STRUCTURE PER EMPLOYEE
--
-- salary_structures has no unique constraint, so an employee can hold two
-- active rows and which one payroll picks depends on query order. That is a
-- silent wrong-salary bug rather than a visible failure.
--
-- MySQL has no partial index, so the rule is expressed as a virtual generated
-- column carrying the user only while the row is active, with a unique key over
-- it -- NULLs are unlimited in a unique index, so an employee may keep any
-- number of superseded structures and exactly one active one.
--
-- VIRTUAL, not STORED: a STORED column rebuilds the table, and MySQL refuses
-- that when the expression reads a foreign-key column. It fails as "ERROR 1215:
-- Cannot add foreign key constraint", which names the wrong object entirely.
--
-- Duplicates are repaired first, keeping the newest by effective_from then id,
-- because adding the key to a table that already violates it fails the
-- migration and Flyway stops at the first error.
--
-- ADDITIVE. No column is dropped or retyped, and no existing row changes value.
-- ============================================================

-- ---------- 1. Earnings and deductions a payslip itemises ----------
ALTER TABLE salary_structures
    ADD COLUMN conveyance_allowance DECIMAL(12,2) NOT NULL DEFAULT 0.00
        COMMENT 'Conveyance. Separate from allowances so a payslip can show it.'
        AFTER allowances,
    ADD COLUMN special_allowance DECIMAL(12,2) NOT NULL DEFAULT 0.00
        COMMENT 'Special allowance.'
        AFTER conveyance_allowance,
    ADD COLUMN bonus DECIMAL(12,2) NOT NULL DEFAULT 0.00
        COMMENT 'Recurring bonus that is part of the structure. A one-off month bonus belongs in salary_months, not here.'
        AFTER special_allowance,
    ADD COLUMN overtime DECIMAL(12,2) NOT NULL DEFAULT 0.00
        COMMENT 'Recurring overtime that is part of the structure.'
        AFTER bonus,
    ADD COLUMN tds_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00
        COMMENT 'Monthly TDS. An amount rather than a rate: it is decided per employee from their declarations, not by a formula here.'
        AFTER pt_amount,
    ADD COLUMN other_deduction DECIMAL(12,2) NOT NULL DEFAULT 0.00
        COMMENT 'Anything else withheld each month.'
        AFTER tds_amount;

-- ---------- 2. Monthly adjustments, without touching the structure ----------
--
-- salary_months exists and carries basic_salary only, so a month's bonus or a
-- leave deduction has nowhere to go and the only way to apply one is to edit the
-- structure -- which then changes every following month too. These are the
-- one-month figures, and the structure stays as it was.

ALTER TABLE salary_months
    ADD COLUMN bonus DECIMAL(12,2) NOT NULL DEFAULT 0.00
        COMMENT 'This month only.',
    ADD COLUMN overtime DECIMAL(12,2) NOT NULL DEFAULT 0.00
        COMMENT 'This month only.',
    ADD COLUMN other_earnings DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    ADD COLUMN leave_deduction DECIMAL(12,2) NOT NULL DEFAULT 0.00
        COMMENT 'Loss of pay for this month.',
    ADD COLUMN advance_deduction DECIMAL(12,2) NOT NULL DEFAULT 0.00
        COMMENT 'Repayment of a salary advance.',
    ADD COLUMN other_deduction DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    ADD COLUMN note VARCHAR(255) NULL
        COMMENT 'Why the adjustment was made, for whoever reads the payslip later.';

-- ---------- 3. Payslip delivery ----------
ALTER TABLE payslips
    ADD COLUMN delivery_status VARCHAR(20) NOT NULL DEFAULT 'NOT_SENT'
        COMMENT 'NOT_SENT | SENT | FAILED. Defaults to NOT_SENT, which is true of every payslip generated before this column existed.',
    ADD COLUMN sent_to VARCHAR(160) NULL
        COMMENT 'The address it actually went to, recorded because an employee''s email can change afterwards.',
    ADD COLUMN sent_by VARCHAR(60) NULL,
    ADD COLUMN sent_at DATETIME NULL,
    ADD COLUMN send_error VARCHAR(500) NULL
        COMMENT 'Why a send failed, so it can be fixed rather than guessed at.';

CREATE INDEX idx_payslip_delivery ON payslips (delivery_status, pay_year, pay_month);

-- ---------- 4. Itemised components on the payslip itself ----------
--
-- A payslip is a snapshot: September's figures must not move when October's
-- salary changes. The columns it snapshots therefore have to include the new
-- components, or a payslip generated after this could not show them.

ALTER TABLE payslips
    ADD COLUMN conveyance_allowance DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER allowances,
    ADD COLUMN special_allowance DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER conveyance_allowance,
    ADD COLUMN bonus DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER special_allowance,
    ADD COLUMN other_earnings DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER bonus,
    ADD COLUMN leave_deduction DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER other_deductions,
    ADD COLUMN advance_deduction DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER leave_deduction;

-- ---------- 5. One active salary structure per employee ----------
--
-- Repair first: keep the newest active row per employee, retire the rest. No
-- row is deleted -- a superseded structure is what a past payslip was
-- calculated from, and deleting it would make an old figure unexplainable.
UPDATE salary_structures s
JOIN (
    SELECT user_id,
           SUBSTRING_INDEX(
               GROUP_CONCAT(id ORDER BY effective_from DESC, id DESC), ',', 1
           ) AS keep_id
    FROM salary_structures
    WHERE active = 1
    GROUP BY user_id
    HAVING COUNT(*) > 1
) dup ON dup.user_id = s.user_id
SET s.active = 0
WHERE s.active = 1
  AND s.id <> dup.keep_id;

ALTER TABLE salary_structures
    ADD COLUMN active_user_id BIGINT
        GENERATED ALWAYS AS (IF(active = 1, user_id, NULL)) VIRTUAL
        COMMENT 'Derived. user_id only while active, else NULL, so the unique key below constrains exactly the active rows. Never written by the application.';

ALTER TABLE salary_structures
    ADD CONSTRAINT uq_salary_structure_active UNIQUE (active_user_id);

-- ---------- 6. One adjustment row per employee per month ----------
--
-- Already enforced: salary_months carries uq_salary_month on
-- (user_id, pay_year, pay_month). Verified against the live schema rather than
-- assumed -- adding it again fails the migration with "Duplicate key name",
-- which is how this was found.

-- Verification -- all must hold:
--   SELECT user_id, COUNT(*) FROM salary_structures WHERE active = 1
--     GROUP BY user_id HAVING COUNT(*) > 1;            -- no rows
--   SELECT delivery_status, COUNT(*) FROM payslips GROUP BY delivery_status;
--   SHOW CREATE TABLE salary_structures;               -- uq_salary_structure_active present
