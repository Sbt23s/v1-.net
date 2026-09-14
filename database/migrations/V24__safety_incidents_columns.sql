-- Add missing columns to safety_incidents for full feature support (idempotent)
-- Uses stored procedure to safely add columns only if they don't exist

DELIMITER //
CREATE PROCEDURE add_safety_columns()
BEGIN
    -- reference_code
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_schema = DATABASE() AND table_name = 'safety_incidents' AND column_name = 'reference_code') THEN
        ALTER TABLE safety_incidents ADD COLUMN reference_code VARCHAR(30) AFTER id;
    END IF;

    -- severity
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_schema = DATABASE() AND table_name = 'safety_incidents' AND column_name = 'severity') THEN
        ALTER TABLE safety_incidents ADD COLUMN severity VARCHAR(20) NOT NULL DEFAULT 'MEDIUM' AFTER incident_type;
    END IF;

    -- resolved_by
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_schema = DATABASE() AND table_name = 'safety_incidents' AND column_name = 'resolved_by') THEN
        ALTER TABLE safety_incidents ADD COLUMN resolved_by BIGINT NULL AFTER status;
    END IF;

    -- resolved_at
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_schema = DATABASE() AND table_name = 'safety_incidents' AND column_name = 'resolved_at') THEN
        ALTER TABLE safety_incidents ADD COLUMN resolved_at DATETIME NULL AFTER resolved_by;
    END IF;

    -- resolution_notes
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_schema = DATABASE() AND table_name = 'safety_incidents' AND column_name = 'resolution_notes') THEN
        ALTER TABLE safety_incidents ADD COLUMN resolution_notes TEXT NULL AFTER resolved_at;
    END IF;
END //
DELIMITER ;

CALL add_safety_columns();
DROP PROCEDURE IF EXISTS add_safety_columns;

-- Backfill reference codes for any existing rows
UPDATE safety_incidents
SET reference_code = CONCAT('SI-', YEAR(created_at), '-', LPAD(id, 5, '0'))
WHERE reference_code IS NULL;
