-- Mark which leave types are PAID (no salary deduction). Only Casual and Sick
-- leave are paid; every other type is unpaid and drives Loss of Pay on payslips.
ALTER TABLE leave_types ADD COLUMN paid BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE leave_types SET paid = TRUE WHERE code IN ('CL', 'SL');
