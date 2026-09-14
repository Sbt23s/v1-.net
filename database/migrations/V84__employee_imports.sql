-- ============================================================
-- V84 — Remembering where a bulk-imported employee came from.
--
-- An Excel import creates accounts one row at a time and then forgets it ever
-- happened, so a sheet uploaded by mistake could only be undone by finding each
-- person it created by hand. Each import is now a record, and every account it
-- creates points back at it, which is what makes "remove this import" possible.
--
-- Additive only. import_batch_id is null for every account that already exists
-- and for every one added by hand afterwards, which is exactly right: those did
-- not come from a sheet and must never be swept up by undoing one.
-- ============================================================

CREATE TABLE IF NOT EXISTS employee_imports (
    id            BIGINT AUTO_INCREMENT PRIMARY KEY,
    file_name     VARCHAR(255) NULL,
    imported_by   BIGINT       NULL,
    imported_at   DATETIME     NOT NULL,
    total_rows    INT          NOT NULL DEFAULT 0,
    created_count INT          NOT NULL DEFAULT 0,
    failed_count  INT          NOT NULL DEFAULT 0,
    -- Set when the import has been undone, so the record of it having happened
    -- survives the accounts being removed.
    reverted_at   DATETIME     NULL,
    reverted_by   BIGINT       NULL,
    CONSTRAINT fk_import_by FOREIGN KEY (imported_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE users ADD COLUMN import_batch_id BIGINT NULL;

-- ON DELETE SET NULL, not CASCADE: removing the record of an import must never
-- be a way to delete people. Undoing an import deletes the accounts explicitly,
-- one at a time, through the same path as deleting an employee by hand.
ALTER TABLE users
    ADD CONSTRAINT fk_users_import_batch
    FOREIGN KEY (import_batch_id) REFERENCES employee_imports(id) ON DELETE SET NULL;

CREATE INDEX idx_users_import_batch ON users (import_batch_id);
CREATE INDEX idx_imports_when ON employee_imports (imported_at);
