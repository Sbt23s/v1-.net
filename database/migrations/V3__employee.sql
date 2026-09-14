-- ============================================================
-- V3 — Employee profile sub-entities
-- US-IT-HR-01 onboarding: bank, documents, family, education, experience
-- ============================================================

CREATE TABLE bank_details (
    id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id             BIGINT NOT NULL,
    bank_name           VARCHAR(120) NOT NULL,
    branch_name         VARCHAR(120),
    account_number      VARCHAR(40)  NOT NULL,
    ifsc_code           VARCHAR(20)  NOT NULL,
    account_holder_name VARCHAR(150) NOT NULL,
    is_primary          BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_bank_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_bank_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE employee_documents (
    id            BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id       BIGINT NOT NULL,
    doc_type      VARCHAR(40) NOT NULL,   -- ID_PROOF, ADDRESS_PROOF, PAN, AADHAAR, CERTIFICATE ...
    file_path     VARCHAR(255) NOT NULL,
    original_name VARCHAR(200),
    verified      BOOLEAN NOT NULL DEFAULT FALSE,
    uploaded_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_doc_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_doc_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE family_members (
    id           BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id      BIGINT NOT NULL,
    name         VARCHAR(150) NOT NULL,
    relationship VARCHAR(40),
    dob          DATE,
    phone        VARCHAR(15),
    is_nominee   BOOLEAN NOT NULL DEFAULT FALSE,
    CONSTRAINT fk_fam_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE educations (
    id           BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id      BIGINT NOT NULL,
    qualification VARCHAR(120),
    institution  VARCHAR(180),
    year_of_passing INT,
    grade        VARCHAR(40),
    CONSTRAINT fk_edu_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE experiences (
    id           BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id      BIGINT NOT NULL,
    company_name VARCHAR(180),
    designation  VARCHAR(120),
    from_date    DATE,
    to_date      DATE,
    CONSTRAINT fk_exp_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Onboarding checklist (US-IT-HR-01 AC3/AC6/AC8)
CREATE TABLE onboarding_checklists (
    id            BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id       BIGINT NOT NULL,
    item          VARCHAR(120) NOT NULL,   -- DOCUMENT_UPLOAD, BANK_DETAILS, ASSET_ALLOCATION, IT_ACCESS
    completed     BOOLEAN NOT NULL DEFAULT FALSE,
    completed_at  DATETIME,
    CONSTRAINT fk_onb_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Worker skill cards (US-CV-SUP-04)
CREATE TABLE worker_skills (
    id           BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id      BIGINT NOT NULL,
    trade        VARCHAR(80),
    skill_level  VARCHAR(30),             -- UNSKILLED | SEMI_SKILLED | SKILLED
    certification VARCHAR(120),
    cert_expiry  DATE,
    assessed_by  BIGINT,
    assessed_at  DATETIME,
    CONSTRAINT fk_skill_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
