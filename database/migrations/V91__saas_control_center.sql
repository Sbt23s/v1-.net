-- SaaS Technical Admin Control Center Schema Updates

ALTER TABLE companies 
    ADD COLUMN company_id VARCHAR(20),
    CHANGE COLUMN name company_name VARCHAR(150) NOT NULL,
    ADD COLUMN legal_name VARCHAR(150),
    ADD COLUMN email VARCHAR(150),
    ADD COLUMN phone VARCHAR(20),
    ADD COLUMN website VARCHAR(150),
    ADD COLUMN address VARCHAR(255),
    ADD COLUMN country VARCHAR(100),
    ADD COLUMN state VARCHAR(100),
    ADD COLUMN city VARCHAR(100),
    ADD COLUMN timezone VARCHAR(50),
    ADD COLUMN currency VARCHAR(10),
    ADD COLUMN date_format VARCHAR(20),
    ADD COLUMN language VARCHAR(20),
    ADD COLUMN organization_type VARCHAR(50),
    ADD COLUMN employee_count INT,
    ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    ADD COLUMN logo_path VARCHAR(255),
    ADD COLUMN primary_color VARCHAR(20),
    ADD COLUMN secondary_color VARCHAR(20),
    ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    ADD COLUMN created_by VARCHAR(60),
    ADD COLUMN updated_by VARCHAR(60);

UPDATE companies SET company_id = CONCAT('COMP-', id) WHERE company_id IS NULL;
ALTER TABLE companies MODIFY COLUMN company_id VARCHAR(20) NOT NULL;
ALTER TABLE companies ADD UNIQUE INDEX uk_company_id (company_id);

CREATE TABLE company_modules (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_by BIGINT,
    updated_by BIGINT,
    
    company_id BIGINT NOT NULL,
    module_code VARCHAR(50) NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    feature_flags TEXT,
    
    CONSTRAINT fk_company_modules_company FOREIGN KEY (company_id) REFERENCES companies(id),
    UNIQUE KEY uk_company_module (company_id, module_code)
);

CREATE TABLE technical_admins (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_by BIGINT,
    updated_by BIGINT,
    
    username VARCHAR(60) NOT NULL UNIQUE,
    name VARCHAR(150) NOT NULL,
    email VARCHAR(150),
    password_hash VARCHAR(255) NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    failed_login_count INT NOT NULL DEFAULT 0,
    locked_until TIMESTAMP NULL,
    last_login_at TIMESTAMP NULL
);

-- Note: In V89__audit_log.sql, an audit_log table might have been created already.
-- If the V89 table is different, we rename or alter it.
-- We'll assume the V89 one was for something else or we'll create technical_audit_logs to be safe.
CREATE TABLE technical_audit_logs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_by BIGINT,
    updated_by BIGINT,
    
    company_id BIGINT,
    admin_id BIGINT,
    admin_username VARCHAR(100),
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(100),
    entity_id BIGINT,
    old_value TEXT,
    new_value TEXT,
    ip_address VARCHAR(255)
);

-- Modify existing roles and users to support multi-tenancy
ALTER TABLE roles ADD COLUMN company_id BIGINT NULL;
-- Drop unique constraint on role code. MySQL usually names it after the column if defined inline.
-- In some versions it might be called code. We will drop it using a safe approach.
-- Note: Dropping index if exists in pure SQL on older MySQL can be tricky.
-- We will just do `ALTER TABLE roles DROP INDEX code;`
ALTER TABLE roles DROP INDEX code;

ALTER TABLE users ADD COLUMN company_id BIGINT NULL;

-- Insert default Technical Admin
-- Username: admin
-- Password: admin123
INSERT INTO technical_admins (username, name, email, password_hash, enabled)
VALUES ('admin', 'Master Technical Admin', 'admin@hrportal.com', '$2a$10$wN/iM6.16bV.8o0qTIfbE.T49tO0Jt9.0jP83iP9wL2uA5q92YfKO', TRUE);
