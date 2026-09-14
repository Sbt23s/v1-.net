-- ============================================================
-- V14 — Reconcile `onboarding_checklists` with its JPA entity.
--
--   Background: V3 created this table with an early design
--   (item / completed / completed_at). V9 later re-declared it with
--   the current design (status / started_at / completed_at) using
--   `CREATE TABLE IF NOT EXISTS`, which silently did nothing because
--   the table already existed. The OnboardingChecklist entity expects
--   `status` and `started_at`, so Hibernate schema-validation failed
--   at startup ("missing column [status]").
--
--   This migration brings any existing table up to the entity's shape,
--   regardless of which columns are currently present. It is written to
--   be safe on a fresh DB (where the table may already be correct) and
--   on an old DB (where only the V3 columns exist). MySQL/MariaDB don't
--   support "ADD COLUMN IF NOT EXISTS" portably, so we guard each change
--   by checking information_schema first.
-- ============================================================

-- --- add `status` if it's missing -----------------------------------------
SET @add_status := (
    SELECT IF(COUNT(*) = 0,
        'ALTER TABLE onboarding_checklists ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT ''IN_PROGRESS''',
        'DO 0')
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'onboarding_checklists'
      AND column_name = 'status'
);
PREPARE s1 FROM @add_status; EXECUTE s1; DEALLOCATE PREPARE s1;

-- --- add `started_at` if it's missing --------------------------------------
SET @add_started := (
    SELECT IF(COUNT(*) = 0,
        'ALTER TABLE onboarding_checklists ADD COLUMN started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP',
        'DO 0')
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'onboarding_checklists'
      AND column_name = 'started_at'
);
PREPARE s2 FROM @add_started; EXECUTE s2; DEALLOCATE PREPARE s2;

-- --- ensure `completed_at` exists (it does in both designs, but be safe) ----
SET @add_completed_at := (
    SELECT IF(COUNT(*) = 0,
        'ALTER TABLE onboarding_checklists ADD COLUMN completed_at DATETIME NULL',
        'DO 0')
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'onboarding_checklists'
      AND column_name = 'completed_at'
);
PREPARE s3 FROM @add_completed_at; EXECUTE s3; DEALLOCATE PREPARE s3;

-- --- migrate old data: a row that was `completed` becomes status COMPLETED --
SET @has_completed := (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'onboarding_checklists'
      AND column_name = 'completed'
);
SET @migrate := IF(@has_completed > 0,
    'UPDATE onboarding_checklists SET status = IF(completed = 1, ''COMPLETED'', ''IN_PROGRESS'')',
    'DO 0');
PREPARE s4 FROM @migrate; EXECUTE s4; DEALLOCATE PREPARE s4;

-- --- drop the obsolete V3 columns if they are still present -----------------
SET @drop_completed := IF(@has_completed > 0,
    'ALTER TABLE onboarding_checklists DROP COLUMN completed',
    'DO 0');
PREPARE s5 FROM @drop_completed; EXECUTE s5; DEALLOCATE PREPARE s5;

SET @has_item := (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'onboarding_checklists'
      AND column_name = 'item'
);
SET @drop_item := IF(@has_item > 0,
    'ALTER TABLE onboarding_checklists DROP COLUMN item',
    'DO 0');
PREPARE s6 FROM @drop_item; EXECUTE s6; DEALLOCATE PREPARE s6;

-- ============================================================
-- Additional schema reconciliations discovered by validating every
-- JPA entity against the migrated schema:
--   * positions.code       — Position entity has `code`, table lacked it (V2).
--   * ta_expenses.created_by — TaExpense entity has `createdBy`, table lacked it (V11).
-- Both are added conditionally so this is safe on any existing database.
-- ============================================================

-- --- positions.code --------------------------------------------------------
SET @add_pos_code := (
    SELECT IF(COUNT(*) = 0,
        'ALTER TABLE positions ADD COLUMN code VARCHAR(40) NULL',
        'DO 0')
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'positions'
      AND column_name = 'code'
);
PREPARE p1 FROM @add_pos_code; EXECUTE p1; DEALLOCATE PREPARE p1;

-- --- ta_expenses.created_by / updated_by ------------------------------------
-- TaExpense extends BaseEntity, which maps `created_by`/`updated_by` as
-- VARCHAR(60) audit columns (populated by Spring Data auditing). V11 created the
-- table without them, so add both as VARCHAR to match the entity.
SET @add_ta_cb := (
    SELECT IF(COUNT(*) = 0,
        'ALTER TABLE ta_expenses ADD COLUMN created_by VARCHAR(60) NULL',
        'DO 0')
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'ta_expenses'
      AND column_name = 'created_by'
);
PREPARE t1 FROM @add_ta_cb; EXECUTE t1; DEALLOCATE PREPARE t1;

SET @add_ta_ub := (
    SELECT IF(COUNT(*) = 0,
        'ALTER TABLE ta_expenses ADD COLUMN updated_by VARCHAR(60) NULL',
        'DO 0')
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'ta_expenses'
      AND column_name = 'updated_by'
);
PREPARE t2 FROM @add_ta_ub; EXECUTE t2; DEALLOCATE PREPARE t2;

-- --- offboarding_records.created_by / updated_by ---------------------------
-- OffboardingRecord also extends BaseEntity; V10 created the table without the
-- audit-author columns. Add both to match the entity.
SET @add_ob_cb := (
    SELECT IF(COUNT(*) = 0,
        'ALTER TABLE offboarding_records ADD COLUMN created_by VARCHAR(60) NULL',
        'DO 0')
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'offboarding_records'
      AND column_name = 'created_by'
);
PREPARE o1 FROM @add_ob_cb; EXECUTE o1; DEALLOCATE PREPARE o1;

SET @add_ob_ub := (
    SELECT IF(COUNT(*) = 0,
        'ALTER TABLE offboarding_records ADD COLUMN updated_by VARCHAR(60) NULL',
        'DO 0')
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'offboarding_records'
      AND column_name = 'updated_by'
);
PREPARE o2 FROM @add_ob_ub; EXECUTE o2; DEALLOCATE PREPARE o2;
