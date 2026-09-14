-- ============================================================
-- V100 — Global Login Announcement / Global Media
-- ============================================================

CREATE TABLE IF NOT EXISTS global_login_announcements (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(255),
    description TEXT,
    media_type VARCHAR(50) NOT NULL,
    media_url VARCHAR(1000) NOT NULL,
    media_name VARCHAR(255),
    media_size BIGINT,
    status VARCHAR(50) NOT NULL DEFAULT 'INACTIVE',
    target_roles VARCHAR(500) NOT NULL DEFAULT 'Employee,TL,HR,Admin',
    duration_seconds INT NOT NULL DEFAULT 15,
    created_by BIGINT,
    created_by_name VARCHAR(255),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    published_at DATETIME,
    deleted_at DATETIME
);
