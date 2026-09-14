-- Fix column types for created_by and updated_by to match BaseEntity (VARCHAR(60))

ALTER TABLE companies MODIFY COLUMN created_by VARCHAR(60) NULL;
ALTER TABLE companies MODIFY COLUMN updated_by VARCHAR(60) NULL;

ALTER TABLE company_modules MODIFY COLUMN created_by VARCHAR(60) NULL;
ALTER TABLE company_modules MODIFY COLUMN updated_by VARCHAR(60) NULL;

ALTER TABLE technical_admins MODIFY COLUMN created_by VARCHAR(60) NULL;
ALTER TABLE technical_admins MODIFY COLUMN updated_by VARCHAR(60) NULL;

ALTER TABLE technical_audit_logs MODIFY COLUMN created_by VARCHAR(60) NULL;
ALTER TABLE technical_audit_logs MODIFY COLUMN updated_by VARCHAR(60) NULL;
