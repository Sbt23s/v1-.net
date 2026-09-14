-- Disciplinary records: HR raises one against an employee, the CTO reviews it.
--
-- Deliberately its own table rather than a kind of complaint. A complaint is
-- raised BY somebody about something; a discipline record is raised ABOUT
-- somebody by HR, carries a severity and an action taken, and is reviewed by
-- the CTO rather than answered by HR. The two share a shape and nothing else.
CREATE TABLE discipline_records (
    id                BIGINT AUTO_INCREMENT PRIMARY KEY,
    reference_code    VARCHAR(30)  NOT NULL UNIQUE,      -- DSP-2026-00001

    employee_id       BIGINT       NOT NULL,             -- who it concerns
    reported_by       BIGINT       NOT NULL,             -- the HR/admin who raised it

    incident_date     DATE         NOT NULL,
    discipline_type   VARCHAR(60)  NOT NULL,             -- Attendance Issue, Late Coming ...
    severity          VARCHAR(20)  NOT NULL DEFAULT 'MEDIUM',  -- LOW|MEDIUM|HIGH|CRITICAL
    subject           VARCHAR(200) NOT NULL,
    description       TEXT         NOT NULL,
    action_taken      VARCHAR(60),                       -- Verbal Warning, Written Warning ...

    -- Comma-separated storage paths, the same shape tickets and leave use, so
    -- the existing /api/files route serves them without a second mechanism.
    attachments       TEXT,

    employee_response TEXT,                              -- filled in by the employee
    responded_at      DATETIME,

    cto_remarks       TEXT,                              -- the CTO's warning message
    reviewed_by       BIGINT,
    reviewed_at       DATETIME,

    status            VARCHAR(20)  NOT NULL DEFAULT 'OPEN',  -- OPEN|UNDER_REVIEW|RESOLVED|CLOSED|CANCELLED

    created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_discipline_employee FOREIGN KEY (employee_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_discipline_reporter FOREIGN KEY (reported_by) REFERENCES users(id),
    INDEX idx_discipline_employee (employee_id),
    INDEX idx_discipline_status (status),
    INDEX idx_discipline_date (incident_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
