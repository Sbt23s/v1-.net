-- ============================================================
-- V7 — Helpdesk + Notifications
-- US-IT-EMP-06, US-CV-ADM-02, US-CV-SUP-05; plus the in-app notification feed
-- ============================================================

CREATE TABLE tickets (
    id            BIGINT AUTO_INCREMENT PRIMARY KEY,
    ticket_code   VARCHAR(30) NOT NULL UNIQUE,
    raised_by     BIGINT NOT NULL,
    title         VARCHAR(200) NOT NULL,
    description   TEXT,
    type          VARCHAR(20) NOT NULL DEFAULT 'IT',  -- IT | FACILITY
    category      VARCHAR(40),                         -- Hardware/Software/Network/HVAC/Plumbing ...
    priority      VARCHAR(20) NOT NULL DEFAULT 'MEDIUM', -- LOW|MEDIUM|HIGH|CRITICAL
    status        VARCHAR(20) NOT NULL DEFAULT 'OPEN',   -- OPEN|IN_PROGRESS|AWAITING_PARTS|RESOLVED|CLOSED
    assigned_to   BIGINT,
    sla_due_at    DATETIME,                            -- per-priority SLA (US-CV-ADM-02 AC4)
    rating        INT,                                 -- 1-5 (US-IT-EMP-06 AC7)
    resolved_at   DATETIME,
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_ticket_user FOREIGN KEY (raised_by) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_ticket_status (status),
    INDEX idx_ticket_raiser (raised_by)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE ticket_comments (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    ticket_id   BIGINT NOT NULL,
    author_id   BIGINT NOT NULL,
    comment     TEXT NOT NULL,
    attachment_path VARCHAR(255),
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_tc_ticket FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE notifications (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id     BIGINT NOT NULL,
    title       VARCHAR(200) NOT NULL,
    body        VARCHAR(500),
    type        VARCHAR(40),                          -- LEAVE|ATTENDANCE|PAYROLL|ASSET|HELPDESK|SYSTEM
    link        VARCHAR(255),
    is_read     BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_notif_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_notif_user (user_id, is_read)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Safety incidents (US-CV-EMP-04) — model present, endpoint scaffolded
CREATE TABLE safety_incidents (
    id           BIGINT AUTO_INCREMENT PRIMARY KEY,
    reported_by  BIGINT,
    site_id      BIGINT,
    incident_type VARCHAR(40),   -- NEAR_MISS|MINOR_INJURY|MAJOR_INJURY|PROPERTY_DAMAGE|ENV_HAZARD
    description  TEXT,
    zone         VARCHAR(120),
    anonymous    BOOLEAN NOT NULL DEFAULT FALSE,
    status       VARCHAR(20) DEFAULT 'OPEN',
    occurred_at  DATETIME,
    created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
