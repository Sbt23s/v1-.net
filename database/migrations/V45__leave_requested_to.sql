-- Route a leave request to a chosen approver (like permissions).
ALTER TABLE leave_requests ADD COLUMN requested_to BIGINT NULL;
