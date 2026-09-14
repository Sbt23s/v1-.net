-- Route a permission request to a specific approver (manager/TL/HR).
ALTER TABLE permission_requests ADD COLUMN requested_to BIGINT NULL;
