-- ============================================================
-- V15 — Payslip request→approve→generate→download workflow,
--        customizable company profile on each payslip, a monthly
--        casual/sick leave cap, and a spreadsheet-style Work Report.
--
-- Everything here is additive and safe on an existing database.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Payslip requests
--    Any employee / HR / manager raises a request; it routes to
--    Admin (SUPER_ADMIN / PAYROLL_RUN holders). Admin fills the
--    customizable payslip form and generates → a payslip row is
--    created and linked back here, and only the requester can then
--    download it from their Payslips page.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payslip_requests (
    id            BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id       BIGINT NOT NULL,                 -- who requested (the requester = the payslip owner)
    pay_month     INT NOT NULL,
    pay_year      INT NOT NULL,
    note          VARCHAR(500),                    -- optional note from the requester
    status        VARCHAR(20) NOT NULL DEFAULT 'PENDING', -- PENDING|APPROVED|REJECTED
    payslip_id    BIGINT,                          -- set once admin generates the payslip
    decided_by    BIGINT,                          -- admin who approved / rejected
    decided_at    DATETIME,
    decision_note VARCHAR(500),
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME NULL,
    CONSTRAINT fk_payreq_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_payreq_user (user_id),
    INDEX idx_payreq_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- 2) Customizable company/payslip fields
--    The admin can override company name, logo, GSTIN, address,
--    bank, designation, allowances/deductions etc. per payslip so
--    the PDF looks exactly like the company's own format. These
--    are stored alongside the payslip so the download reproduces
--    precisely what the admin entered.
-- ------------------------------------------------------------
ALTER TABLE payslips
    ADD COLUMN company_name    VARCHAR(160)  NULL,
    ADD COLUMN company_logo    VARCHAR(255)  NULL,   -- relative storage path of uploaded logo
    ADD COLUMN company_gstin   VARCHAR(40)   NULL,
    ADD COLUMN company_address VARCHAR(400)  NULL,
    ADD COLUMN bank_name       VARCHAR(120)  NULL,
    ADD COLUMN bank_account    VARCHAR(60)   NULL,
    ADD COLUMN designation     VARCHAR(120)  NULL,
    ADD COLUMN department      VARCHAR(120)  NULL,
    ADD COLUMN pay_date        DATE          NULL,
    ADD COLUMN working_days    INT           NULL,
    ADD COLUMN performance_pay DECIMAL(12,2) NOT NULL DEFAULT 0,
    ADD COLUMN expenses_pay    DECIMAL(12,2) NOT NULL DEFAULT 0,
    ADD COLUMN salary_advance  DECIMAL(12,2) NOT NULL DEFAULT 0,
    ADD COLUMN health_insurance DECIMAL(12,2) NOT NULL DEFAULT 0,
    ADD COLUMN source          VARCHAR(20)   NOT NULL DEFAULT 'BATCH'; -- BATCH|REQUEST

-- ------------------------------------------------------------
-- 3) Monthly casual/sick leave cap (1 each per calendar month)
--    A small config row per leave-type code holds the per-month
--    limit. NULL / absent => no monthly cap (existing behaviour).
-- ------------------------------------------------------------
ALTER TABLE leave_types
    ADD COLUMN monthly_limit INT NULL;   -- max approvable days of this type per calendar month

UPDATE leave_types SET monthly_limit = 1 WHERE code IN ('CL', 'SL');

-- ------------------------------------------------------------
-- 4) Work reports — spreadsheet-style daily log
--    Employee fills date / project / hours / module. HR & Admin see
--    everyone's rows grouped per employee with search.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS work_reports (
    id            BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id       BIGINT NOT NULL,
    work_date     DATE NOT NULL,
    project_name  VARCHAR(160) NOT NULL,
    work_hours    DECIMAL(4,1) NOT NULL DEFAULT 0,
    task_description TEXT,
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME NULL,
    CONSTRAINT fk_workreport_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_workreport_user (user_id),
    INDEX idx_workreport_date (work_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
