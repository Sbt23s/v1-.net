-- ============================================================
-- V28 — Extra employee profile fields (from the company's real
-- employee sheet): PAN, alternate phone, emergency contact,
-- blood group, personal email, and free-text designation /
-- department / position titles.
-- ============================================================

ALTER TABLE users
    ADD COLUMN pan                        VARCHAR(20),
    ADD COLUMN alternate_phone            VARCHAR(20),
    ADD COLUMN emergency_contact          VARCHAR(120),
    ADD COLUMN emergency_contact_relation VARCHAR(60),
    ADD COLUMN blood_group                VARCHAR(10),
    ADD COLUMN personal_email             VARCHAR(150),
    ADD COLUMN designation_title          VARCHAR(150),
    ADD COLUMN department_title           VARCHAR(150),
    ADD COLUMN position_title             VARCHAR(120);
