-- ============================================================
-- V35 — Expense category on travel/claims entries.
-- ------------------------------------------------------------
-- Employees pick a category (Petrol, House Rent, Snacks, Room,
-- Construction Things, Others). "Others" is a free-text value
-- typed by the employee, stored here directly.
-- ============================================================

ALTER TABLE ta_expenses
    ADD COLUMN category VARCHAR(80) NULL;
