-- ============================================================
-- V89 — Make the audit trail usable: who did what, when, from where.
--
-- An audit_log table already existed, created long ago and never written to:
-- actor_id, action, entity_type, entity_id, details, ip_address, created_at. It
-- is extended here rather than replaced — the existing columns keep their names
-- and meanings, so anything that ever did read them still can.
--
-- What was missing is what makes a trail readable. The actor's name and code, so
-- a row still means something after the account is deleted. A category, to group
-- them. A sentence, so somebody can skim rather than decode. The request itself —
-- method, path, status, device, how long it took — because "who changed this" is
-- usually followed by "from where, and did it work".
--
-- login_history already recorded sign-ins and is left exactly as it is; the audit
-- page reads both.
-- ============================================================

-- Who, in words that survive the account being removed.
ALTER TABLE audit_log
    ADD COLUMN user_name     VARCHAR(150) NULL AFTER actor_id,
    ADD COLUMN employee_code VARCHAR(30)  NULL AFTER user_name,
    ADD COLUMN roles         VARCHAR(255) NULL AFTER employee_code;

-- What, grouped and in a sentence.
ALTER TABLE audit_log
    ADD COLUMN category      VARCHAR(40)  NOT NULL DEFAULT 'SYSTEM' AFTER roles,
    ADD COLUMN summary       VARCHAR(500) NULL AFTER action,
    ADD COLUMN entity_label  VARCHAR(200) NULL AFTER entity_id;

-- Where from, and whether it worked.
ALTER TABLE audit_log
    ADD COLUMN method        VARCHAR(10)  NULL,
    ADD COLUMN path          VARCHAR(400) NULL,
    ADD COLUMN status        INT          NULL,
    ADD COLUMN device        VARCHAR(255) NULL,
    ADD COLUMN duration_ms   INT          NULL,
    ADD COLUMN succeeded     BOOLEAN      NOT NULL DEFAULT TRUE;

-- The three ways this table is actually read: newest first, one person's
-- history, and everything about one record. entity_type/entity_id and actor_id
-- already carry indexes from the original table.
CREATE INDEX idx_audit_when     ON audit_log (created_at);
CREATE INDEX idx_audit_category ON audit_log (category, created_at);
CREATE INDEX idx_audit_actor_at ON audit_log (actor_id, created_at);
