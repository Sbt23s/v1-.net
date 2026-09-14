-- Hours-wise "permission" requests (short time-off during a work day).
CREATE TABLE IF NOT EXISTS permission_requests (
    id               BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id          BIGINT NOT NULL,
    request_date     DATE NOT NULL,
    from_time        VARCHAR(5) NOT NULL,   -- HH:mm
    to_time          VARCHAR(5) NOT NULL,   -- HH:mm
    hours            DECIMAL(4,2) NOT NULL DEFAULT 0,
    reason           VARCHAR(500),
    status           VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    decided_by       BIGINT,
    decided_at       TIMESTAMP NULL,
    decision_comment VARCHAR(500),
    created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_perm_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
