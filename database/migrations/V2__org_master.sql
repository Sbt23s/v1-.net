-- ============================================================
-- V2 — Organisation & master data (drives the dropdown API)
-- US-IT-HR-02 (calendars/policies), US-CV-ADM-01 (sites)
-- ============================================================

CREATE TABLE companies (
    id         BIGINT AUTO_INCREMENT PRIMARY KEY,
    name       VARCHAR(150) NOT NULL,
    code       VARCHAR(40)  NOT NULL UNIQUE,
    industry   VARCHAR(20)  NOT NULL DEFAULT 'IT',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE branches (
    id         BIGINT AUTO_INCREMENT PRIMARY KEY,
    company_id BIGINT,
    name       VARCHAR(150) NOT NULL,
    code       VARCHAR(40)  NOT NULL UNIQUE,
    address    VARCHAR(255),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_branch_company FOREIGN KEY (company_id) REFERENCES companies(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Generic master-data tables fronted by the /api/dropdown endpoint
CREATE TABLE departments (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    code VARCHAR(40) UNIQUE,
    active BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE designations (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    code VARCHAR(40) UNIQUE,
    active BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE blood_groups (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(10) NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE employment_statuses (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(60) NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE positions (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE office_locations (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    address VARCHAR(255),
    latitude  DECIMAL(10,7),
    longitude DECIMAL(10,7),
    geofence_radius_metres INT DEFAULT 200,   -- US-IT-EMP-03 AC2
    active BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Civil project sites (US-CV-ADM-01) — richer than an office location
CREATE TABLE sites (
    id            BIGINT AUTO_INCREMENT PRIMARY KEY,
    name          VARCHAR(150) NOT NULL,
    code          VARCHAR(40)  NOT NULL UNIQUE,
    address       VARCHAR(255),
    latitude      DECIMAL(10,7),
    longitude     DECIMAL(10,7),
    geofence_radius_metres INT DEFAULT 200,   -- configurable 50–500m (AC2)
    project_start DATE,
    project_end   DATE,
    site_manager_id BIGINT,
    active        BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE shifts (
    id         BIGINT AUTO_INCREMENT PRIMARY KEY,
    name       VARCHAR(60) NOT NULL,        -- General, Night, Morning ...
    start_time TIME NOT NULL,
    end_time   TIME NOT NULL,
    is_night   BOOLEAN NOT NULL DEFAULT FALSE,
    active     BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE holidays (
    id           BIGINT AUTO_INCREMENT PRIMARY KEY,
    name         VARCHAR(120) NOT NULL,
    holiday_date DATE NOT NULL,
    state        VARCHAR(80),               -- per location/state (US-IT-HR-02 AC6)
    site_id      BIGINT,
    created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_holiday_date (holiday_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Company announcements (US-IT-EMP-01 AC5)
CREATE TABLE announcements (
    id         BIGINT AUTO_INCREMENT PRIMARY KEY,
    title      VARCHAR(200) NOT NULL,
    body       TEXT,
    published_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(60)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
