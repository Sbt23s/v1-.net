-- The technical audit log is read one company at a time, newest first, and had
-- nothing but its primary key to read by.
--
-- TechnicalAuditLogRepository.findByCompanyIdOrderByCreatedAtDesc is the only
-- query against this table, and with no index on either column MySQL scanned
-- every row and then sorted the result -- on the largest table in the schema,
-- and on every load of the technical admin page. The composite covers both
-- halves of that query: company_id narrows, created_at DESC is then already in
-- order.
--
-- Created only if it is missing, because this schema is shared by two branches
-- that reuse version numbers and repair-on-migrate is on -- a plain CREATE
-- INDEX that has already run elsewhere would fail the startup rather than be
-- skipped.

SET @exists := (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name   = 'technical_audit_logs'
      AND index_name   = 'idx_tal_company_created'
);

SET @sql := IF(@exists = 0,
    'CREATE INDEX idx_tal_company_created ON technical_audit_logs (company_id, created_at DESC)',
    'SELECT 1');

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
