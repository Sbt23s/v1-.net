-- ============================================================
-- V6 — Asset management (US-IT-AST-01..04, US-CV-AST-01..02, US-CV-ADM-03)
-- One table serves IT assets, infra assets and heavy machinery via `category`.
-- ============================================================

CREATE TABLE assets (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    asset_code      VARCHAR(40) NOT NULL UNIQUE,    -- auto-generated (AC2)
    category        VARCHAR(30) NOT NULL DEFAULT 'IT', -- IT | INFRA | MACHINERY
    asset_type      VARCHAR(60),                    -- Laptop, Excavator, Generator ...
    brand           VARCHAR(80),
    model           VARCHAR(80),
    serial_number   VARCHAR(120),
    registration_no VARCHAR(60),                    -- vehicles/machinery
    purchase_date   DATE,
    purchase_cost   DECIMAL(12,2),
    warranty_expiry DATE,
    amc_expiry      DATE,
    status          VARCHAR(20) NOT NULL DEFAULT 'IN_STOCK', -- IN_STOCK|ASSIGNED|UNDER_REPAIR|RETIRED|LOST|DEPLOYED|BREAKDOWN
    site_id         BIGINT,
    assigned_to     BIGINT,
    qr_path         VARCHAR(255),
    depreciation_rate DECIMAL(5,2),
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_asset_status (status),
    INDEX idx_asset_category (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE asset_allocations (
    id            BIGINT AUTO_INCREMENT PRIMARY KEY,
    asset_id      BIGINT NOT NULL,
    user_id       BIGINT NOT NULL,
    allocated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    acknowledged  BOOLEAN NOT NULL DEFAULT FALSE,   -- e-signature ack (AC3)
    acknowledged_at DATETIME,
    returned_at   DATETIME,
    return_condition VARCHAR(20),                   -- GOOD|DAMAGED|LOST
    CONSTRAINT fk_alloc_asset FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE,
    CONSTRAINT fk_alloc_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_alloc_asset (asset_id),
    INDEX idx_alloc_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE asset_maintenance (
    id            BIGINT AUTO_INCREMENT PRIMARY KEY,
    asset_id      BIGINT NOT NULL,
    fault_desc    VARCHAR(500),
    vendor        VARCHAR(120),
    estimated_tat VARCHAR(60),
    cost          DECIMAL(12,2),
    status        VARCHAR(20) DEFAULT 'OPEN',       -- OPEN|IN_PROGRESS|DONE
    scheduled_for DATE,                             -- preventive (US-CV-AST-02)
    interval_days INT,
    interval_hours INT,
    logged_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_maint_asset FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE software_licenses (
    id             BIGINT AUTO_INCREMENT PRIMARY KEY,
    product_name   VARCHAR(120) NOT NULL,
    vendor         VARCHAR(120),
    license_key    VARCHAR(255),
    license_type   VARCHAR(20),                     -- PERPETUAL | SUBSCRIPTION
    seats_purchased INT NOT NULL DEFAULT 0,
    seats_consumed  INT NOT NULL DEFAULT 0,
    expiry_date    DATE,
    created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
