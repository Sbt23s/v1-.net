-- ============================================================
-- V5 — Payroll (US-IT-EMP-04, US-IT-HR-03, US-CV-EMP-03)
-- Components match the existing PHP payslip API.
-- ============================================================

CREATE TABLE salary_structures (
    id            BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id       BIGINT NOT NULL,
    basic_salary  DECIMAL(12,2) NOT NULL DEFAULT 0,
    hra           DECIMAL(12,2) NOT NULL DEFAULT 0,
    allowances    DECIMAL(12,2) NOT NULL DEFAULT 0,
    pf_percentage DECIMAL(5,2)  NOT NULL DEFAULT 12.0,
    esi_applicable BOOLEAN NOT NULL DEFAULT TRUE,
    pt_amount     DECIMAL(8,2)  NOT NULL DEFAULT 0,
    effective_from DATE,
    active        BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_sal_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE payroll_runs (
    id            BIGINT AUTO_INCREMENT PRIMARY KEY,
    pay_month     INT NOT NULL,
    pay_year      INT NOT NULL,
    status        VARCHAR(20) NOT NULL DEFAULT 'PREVIEW', -- PREVIEW|CONFIRMED|FINANCE_APPROVED|PAID
    run_by        BIGINT,
    run_at        DATETIME,
    finance_approved_by BIGINT,
    finance_approved_at DATETIME,
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_run (pay_month, pay_year)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE payslips (
    id            BIGINT AUTO_INCREMENT PRIMARY KEY,
    payroll_run_id BIGINT,
    user_id       BIGINT NOT NULL,
    pay_month     INT NOT NULL,
    pay_year      INT NOT NULL,
    basic_salary  DECIMAL(12,2) NOT NULL DEFAULT 0,
    hra           DECIMAL(12,2) NOT NULL DEFAULT 0,
    allowances    DECIMAL(12,2) NOT NULL DEFAULT 0,
    overtime_pay  DECIMAL(12,2) NOT NULL DEFAULT 0,
    gross_salary  DECIMAL(12,2) NOT NULL DEFAULT 0,
    pf_deduction  DECIMAL(12,2) NOT NULL DEFAULT 0,
    esi_deduction DECIMAL(12,2) NOT NULL DEFAULT 0,
    pt_deduction  DECIMAL(12,2) NOT NULL DEFAULT 0,
    tds_deduction DECIMAL(12,2) NOT NULL DEFAULT 0,
    other_deductions DECIMAL(12,2) NOT NULL DEFAULT 0,
    total_deductions DECIMAL(12,2) NOT NULL DEFAULT 0,
    net_pay       DECIMAL(12,2) NOT NULL DEFAULT 0,
    lop_days      DECIMAL(5,1) NOT NULL DEFAULT 0,
    pdf_path      VARCHAR(255),
    generated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_pay_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY uq_payslip (user_id, pay_month, pay_year),
    INDEX idx_payslip_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Investment declarations (US-IT-EMP-05) — model present, endpoint scaffolded
CREATE TABLE investment_declarations (
    id           BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id      BIGINT NOT NULL,
    fin_year     VARCHAR(9) NOT NULL,   -- 2025-2026
    section      VARCHAR(20) NOT NULL,  -- 80C, 80D, HRA, LTA, NPS ...
    declared_amount DECIMAL(12,2) NOT NULL,
    proof_path   VARCHAR(255),
    status       VARCHAR(20) DEFAULT 'PROVISIONAL', -- PROVISIONAL|FINAL|APPROVED|REJECTED
    created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_decl_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Expense claims (US-IT-FIN-02) — model present, endpoint scaffolded
CREATE TABLE expense_claims (
    id           BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id      BIGINT NOT NULL,
    category     VARCHAR(60),
    amount       DECIMAL(12,2) NOT NULL,
    claim_date   DATE,
    receipt_path VARCHAR(255),
    manager_status VARCHAR(20) DEFAULT 'PENDING',
    finance_status VARCHAR(20) DEFAULT 'PENDING',
    created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_claim_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
