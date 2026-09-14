-- ============================================================
-- V1 — Core identity, security, RBAC, audit
-- Identity is Aadhaar-based (matches existing PHP API).
-- ============================================================

CREATE TABLE roles (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    code        VARCHAR(40)  NOT NULL UNIQUE,   -- IT_EMP, IT_HR, CV_SUP, SUPER_ADMIN ...
    name        VARCHAR(120) NOT NULL,
    industry    VARCHAR(20)  NOT NULL DEFAULT 'BOTH', -- IT | CIVIL | BOTH
    description VARCHAR(255),
    created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE permissions (
    id    BIGINT AUTO_INCREMENT PRIMARY KEY,
    code  VARCHAR(60)  NOT NULL UNIQUE,         -- LEAVE_APPROVE, PAYROLL_RUN, ASSET_MANAGE ...
    name  VARCHAR(120) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE role_permissions (
    role_id       BIGINT NOT NULL,
    permission_id BIGINT NOT NULL,
    PRIMARY KEY (role_id, permission_id),
    CONSTRAINT fk_rp_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
    CONSTRAINT fk_rp_perm FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE users (
    id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
    employee_code       VARCHAR(40) UNIQUE,           -- auto-generated (US-IT-HR-01 AC2)
    name                VARCHAR(150) NOT NULL,
    dob                 DATE,
    gender              CHAR(1),                       -- M | F | O
    aadhar              VARCHAR(12)  NOT NULL UNIQUE,
    phone               VARCHAR(15)  NOT NULL UNIQUE,
    email               VARCHAR(150),
    password_hash       VARCHAR(255) NOT NULL,
    photo_path          VARCHAR(255),

    -- address block (from existing API)
    care_of             VARCHAR(120),
    house               VARCHAR(120),
    street              VARCHAR(150),
    locality            VARCHAR(150),
    vtc                 VARCHAR(120),                  -- village/town/city
    district            VARCHAR(120),
    state               VARCHAR(120),
    country             VARCHAR(120) DEFAULT 'India',
    pincode             VARCHAR(10),
    post_office         VARCHAR(120),

    -- employment
    blood_group_id      BIGINT,
    department_id       BIGINT,
    designation_id      BIGINT,
    office_location_id  BIGINT,
    employment_status_id BIGINT,
    position_id         BIGINT,
    reporting_manager_id BIGINT,
    site_id             BIGINT,                        -- civil site assignment
    employment_type     VARCHAR(30) DEFAULT 'PERMANENT', -- PERMANENT|CONTRACTUAL|DAILY_WAGE|SUBCONTRACTOR
    date_of_joining     DATE,
    industry            VARCHAR(20) DEFAULT 'IT',      -- IT | CIVIL

    -- lifecycle + security state
    profile_status      VARCHAR(20) DEFAULT 'PENDING', -- PENDING|ACTIVE|INACTIVE|EXITED
    enabled             BOOLEAN NOT NULL DEFAULT TRUE,
    failed_login_count  INT NOT NULL DEFAULT 0,
    locked_until        DATETIME,
    last_login_at       DATETIME,

    created_by          VARCHAR(60),
    updated_by          VARCHAR(60),
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_users_dept (department_id),
    INDEX idx_users_mgr (reporting_manager_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE user_roles (
    user_id BIGINT NOT NULL,
    role_id BIGINT NOT NULL,
    PRIMARY KEY (user_id, role_id),
    CONSTRAINT fk_ur_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_ur_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE refresh_tokens (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id     BIGINT NOT NULL,
    token       VARCHAR(512) NOT NULL UNIQUE,
    expires_at  DATETIME NOT NULL,
    revoked     BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_rt_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE login_history (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id     BIGINT,
    aadhar      VARCHAR(12),
    success     BOOLEAN NOT NULL,
    ip_address  VARCHAR(45),
    user_agent  VARCHAR(255),
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_login_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE audit_log (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    actor_id    BIGINT,
    action      VARCHAR(120) NOT NULL,
    entity_type VARCHAR(80),
    entity_id   VARCHAR(60),
    details     TEXT,
    ip_address  VARCHAR(45),
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_audit_actor (actor_id),
    INDEX idx_audit_entity (entity_type, entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE otp_codes (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    phone       VARCHAR(15) NOT NULL,
    code        VARCHAR(8)  NOT NULL,
    purpose     VARCHAR(30) NOT NULL,   -- LOGIN | FORGOT_PASSWORD
    expires_at  DATETIME    NOT NULL,
    consumed    BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_otp_phone (phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
