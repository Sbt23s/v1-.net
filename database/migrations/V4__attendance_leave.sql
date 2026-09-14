-- ============================================================
-- V4 — Attendance & Leave
-- US-IT-EMP-03, US-CV-EMP-01 (GPS/geofence/WFH); US-IT-EMP-02, US-IT-MGR-01
-- ============================================================

CREATE TABLE attendance (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id         BIGINT NOT NULL,
    work_date       DATE   NOT NULL,
    punch_in_at     DATETIME,
    punch_out_at    DATETIME,
    mode            VARCHAR(20) DEFAULT 'OFFICE',   -- OFFICE | WFH | SITE | BIOMETRIC
    in_latitude     DECIMAL(10,7),
    in_longitude    DECIMAL(10,7),
    out_latitude    DECIMAL(10,7),
    out_longitude   DECIMAL(10,7),
    site_id         BIGINT,
    shift_id        BIGINT,
    within_geofence BOOLEAN,
    status          VARCHAR(20) DEFAULT 'PRESENT',  -- PRESENT|ABSENT|WFH|HOLIDAY|LEAVE|HALF_DAY
    is_late         BOOLEAN NOT NULL DEFAULT FALSE,
    worked_minutes  INT,
    overtime_minutes INT DEFAULT 0,
    geofence_exception BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_att_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY uq_att_user_date (user_id, work_date),  -- prevents duplicate punch-in (AC4)
    INDEX idx_att_date (work_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE leave_types (
    id                BIGINT AUTO_INCREMENT PRIMARY KEY,
    name              VARCHAR(80) NOT NULL,
    code              VARCHAR(20) NOT NULL UNIQUE,    -- CL, SL, EL, COMP, MAT, PAT, LOP ...
    max_days_per_year INT,
    carry_forward     BOOLEAN NOT NULL DEFAULT FALSE,
    encashable        BOOLEAN NOT NULL DEFAULT FALSE,
    gender_restriction CHAR(1),                       -- e.g. 'F' for maternity (AC3)
    allow_past_dates  BOOLEAN NOT NULL DEFAULT FALSE, -- sick leave can be retroactive
    accrual_type      VARCHAR(20) DEFAULT 'ANNUAL',   -- ANNUAL | MONTHLY | MANUAL
    min_notice_days   INT DEFAULT 0,                  -- civil min-notice (US-CV-EMP-02 AC2)
    active            BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE leave_balances (
    id           BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id      BIGINT NOT NULL,
    leave_type_id BIGINT NOT NULL,
    year         INT NOT NULL,
    allocated    DECIMAL(5,1) NOT NULL DEFAULT 0,
    used         DECIMAL(5,1) NOT NULL DEFAULT 0,
    CONSTRAINT fk_lb_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_lb_type FOREIGN KEY (leave_type_id) REFERENCES leave_types(id),
    UNIQUE KEY uq_balance (user_id, leave_type_id, year)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE leave_requests (
    id            BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id       BIGINT NOT NULL,
    leave_type_id BIGINT NOT NULL,
    from_date     DATE NOT NULL,
    to_date       DATE NOT NULL,
    working_days  DECIMAL(5,1) NOT NULL,              -- excludes weekends + holidays (AC9)
    reason        VARCHAR(500),
    attachment_path VARCHAR(255),
    status        VARCHAR(20) NOT NULL DEFAULT 'PENDING', -- PENDING|APPROVED|REJECTED|CANCELLED
    decided_by    BIGINT,
    decided_at    DATETIME,
    decision_comment VARCHAR(500),
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_lr_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_lr_type FOREIGN KEY (leave_type_id) REFERENCES leave_types(id),
    INDEX idx_lr_status (status),
    INDEX idx_lr_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
