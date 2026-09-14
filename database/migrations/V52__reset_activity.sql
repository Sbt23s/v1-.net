-- One-time: clear activity data for a fresh start. Runs once on deploy.
-- Employees, logins, teams, leave types, asset INVENTORY and config are kept.
SET FOREIGN_KEY_CHECKS = 0;

-- Leave + Approvals (balances kept, usage reset to 0)
DELETE FROM leave_requests;
UPDATE leave_balances SET used = 0;

-- Permissions
DELETE FROM permission_requests;

-- Work reports
DELETE FROM work_reports;

-- Supports (tickets)
DELETE FROM ticket_comments;
DELETE FROM tickets;

-- Claims / expenses
DELETE FROM expense_claims;
DELETE FROM ta_expenses;

-- Asset assignments + maintenance (inventory rows kept)
DELETE FROM asset_allocations;
DELETE FROM asset_maintenance;

SET FOREIGN_KEY_CHECKS = 1;
