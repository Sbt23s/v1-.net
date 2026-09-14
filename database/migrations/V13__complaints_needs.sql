-- ============================================================
-- V13 — Complaints / Needs
--   A lightweight channel for employees and managers to raise a
--   complaint or a need/requirement. HR and Admin see every entry
--   and can respond / change its status.
-- ============================================================

CREATE TABLE complaints_needs (
    id            BIGINT AUTO_INCREMENT PRIMARY KEY,
    reference_code VARCHAR(30) NOT NULL UNIQUE,          -- CN-2026-00001
    raised_by     BIGINT      NOT NULL,                  -- users.id of submitter
    kind          VARCHAR(20) NOT NULL DEFAULT 'COMPLAINT', -- COMPLAINT | NEED
    category      VARCHAR(60),                           -- optional grouping (e.g. Facilities, IT, Payroll)
    subject       VARCHAR(200) NOT NULL,
    description   TEXT         NOT NULL,
    priority      VARCHAR(20) NOT NULL DEFAULT 'MEDIUM',  -- LOW | MEDIUM | HIGH
    status        VARCHAR(20) NOT NULL DEFAULT 'OPEN',    -- OPEN | IN_REVIEW | RESOLVED | REJECTED
    hr_response   TEXT,                                   -- reply from HR/Admin
    handled_by    BIGINT,                                 -- users.id of HR/Admin who responded
    resolved_at   DATETIME,
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_cn_raised_by FOREIGN KEY (raised_by) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_cn_raised_by (raised_by),
    INDEX idx_cn_status (status),
    INDEX idx_cn_kind (kind)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
