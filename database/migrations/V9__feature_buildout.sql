-- ============================================================
-- V9 — Feature Build-out: Onboarding and Performance
-- ============================================================

-- Onboarding Module
CREATE TABLE IF NOT EXISTS onboarding_checklists (
    id            BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id       BIGINT NOT NULL,
    status        VARCHAR(20) NOT NULL DEFAULT 'IN_PROGRESS',
    started_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at  DATETIME,
    CONSTRAINT fk_onb_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS onboarding_tasks (
    id            BIGINT AUTO_INCREMENT PRIMARY KEY,
    checklist_id  BIGINT NOT NULL,
    task_name     VARCHAR(120) NOT NULL,
    description   VARCHAR(255),
    is_completed  BOOLEAN NOT NULL DEFAULT FALSE,
    completed_at  DATETIME,
    CONSTRAINT fk_onb_task_chk
        FOREIGN KEY (checklist_id) REFERENCES onboarding_checklists(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Performance & Appraisal Module
CREATE TABLE IF NOT EXISTS performance_goals (
    id            BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id       BIGINT NOT NULL,
    title         VARCHAR(150) NOT NULL,
    description   TEXT,
    progress      INT NOT NULL DEFAULT 0,
    status        VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_perf_goal_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS performance_reviews (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id         BIGINT NOT NULL,
    manager_id      BIGINT NOT NULL,
    review_period   VARCHAR(20) NOT NULL,
    self_rating     INT,
    self_comment    TEXT,
    manager_rating  INT,
    manager_comment TEXT,
    status          VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_perf_rev_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_perf_rev_mgr
        FOREIGN KEY (manager_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;