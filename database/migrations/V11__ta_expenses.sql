-- ============================================================
-- V11 — Feature Build-out: TA Expenses & System Settings
-- ============================================================

CREATE TABLE system_settings (
    setting_key VARCHAR(50) PRIMARY KEY,
    setting_value VARCHAR(255) NOT NULL,
    description VARCHAR(255),
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO system_settings (setting_key, setting_value, description) VALUES
('HILLS_KM_RATE', '5.0', 'Amount per KM for Hills'),
('PLAINS_KM_RATE', '3.0', 'Amount per KM for Plains');

CREATE TABLE ta_expenses (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NOT NULL,
    date DATE NOT NULL,
    location VARCHAR(150),
    starting_km INT,
    ending_km INT,
    total_km INT,
    hills_km INT,
    plains_km INT,
    total_amount DECIMAL(10, 2),
    bus_fare DECIMAL(10, 2),
    others DECIMAL(10, 2),
    gross_total DECIMAL(10, 2),
    remarks VARCHAR(255),
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_ta_exp_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
