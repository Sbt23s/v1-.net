-- ============================================================
-- V19 — Update designations to custom user-defined list.
-- ============================================================

SET FOREIGN_KEY_CHECKS = 0;

TRUNCATE TABLE designations;

INSERT INTO designations (name, code) VALUES
 ('Senior Software Developer', 'SR_DEV'),
 ('Junior Developer', 'JR_DEV'),
 ('Office Admin', 'OFF_ADM'),
 ('Digital Marketing', 'DIG_MKT'),
 ('AI Engineer', 'AI_ENG'),
 ('Graphics Designer', 'GFX_DES'),
 ('UI UX Designer', 'UI_UX'),
 ('QA Testing', 'QA_TST');

UPDATE users SET designation_id = NULL;

SET FOREIGN_KEY_CHECKS = 1;
