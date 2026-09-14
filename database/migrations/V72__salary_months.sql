-- ============================================================
-- V72 — basic salary per month.
--
-- salary_structures holds the standing figures for an employee.
-- This holds what their basic pay actually was for one month, so a
-- raise, a cut or a part month is recorded against that month
-- rather than rewriting the standing structure and losing what the
-- earlier months were paid on.
--
-- Generating a payslip uses the row for that month when one exists
-- and falls back to the standing basic when it does not, so nothing
-- changes for employees who have no month rows.
-- ============================================================

CREATE TABLE salary_months (
    id           BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id      BIGINT NOT NULL,
    pay_year     INT NOT NULL,
    pay_month    INT NOT NULL,               -- 1..12
    basic_salary DECIMAL(12,2) NOT NULL DEFAULT 0,
    created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_salmonth_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY uq_salary_month (user_id, pay_year, pay_month),
    INDEX idx_salmonth_period (pay_year, pay_month)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
