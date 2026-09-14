-- ============================================================
-- One-time: clear the trial activity so the portal starts fresh.
-- Follows V52 exactly in what it protects.
--
-- KEPT — nothing about people or setup is touched:
--   users, logins, roles and permissions
--   teams / designations / departments
--   leave types and leave balance allocations
--   asset inventory, holidays, settings, chat and communities
--
-- CLEARED — the activity built up while testing:
--   tasks, leave requests, permission requests, work reports,
--   support tickets and their comments, expense claims,
--   complaints, attendance punches, notifications
-- ============================================================

SET FOREIGN_KEY_CHECKS = 0;

-- Tasks
DELETE FROM tasks;

-- Leave and approvals (allocations kept, usage reset to zero)
DELETE FROM leave_requests;
UPDATE leave_balances SET used = 0;

-- Permission requests
DELETE FROM permission_requests;

-- Work reports
DELETE FROM work_reports;

-- Supports
DELETE FROM ticket_comments;
DELETE FROM tickets;

-- Claims
DELETE FROM expense_claims;
DELETE FROM ta_expenses;

-- Complaints, needs and safety incidents
DELETE FROM complaints_needs;
DELETE FROM safety_incidents;

-- Asset allocations and maintenance logs. The inventory rows themselves stay,
-- so registered equipment survives and simply reads as unallocated again.
DELETE FROM asset_allocations;
DELETE FROM asset_maintenance;

-- Announcements posted while testing
DELETE FROM announcements;

-- The activity log behind "Recent Activity"
DELETE FROM audit_log;

-- Attendance punches — the present / absent counts read from these, so stale
-- rows would make a fresh start report the wrong numbers on day one.
DELETE FROM attendance;

-- Notifications
DELETE FROM notifications;

SET FOREIGN_KEY_CHECKS = 1;
