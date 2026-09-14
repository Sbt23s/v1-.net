-- ============================================================
-- V20 — Clear transaction data (attendance, leave requests, etc.)
-- ============================================================

SET FOREIGN_KEY_CHECKS = 0;

TRUNCATE TABLE attendance;
TRUNCATE TABLE leave_requests;
TRUNCATE TABLE ta_expenses;
TRUNCATE TABLE tickets;

SET FOREIGN_KEY_CHECKS = 1;
