-- Record who decided a claim and why, so employees see the reason for a
-- rejection and HR has an audit trail.
ALTER TABLE ta_expenses
    ADD COLUMN decision_comment VARCHAR(500) NULL,
    ADD COLUMN decided_by BIGINT NULL,
    ADD COLUMN decided_at DATETIME NULL;
