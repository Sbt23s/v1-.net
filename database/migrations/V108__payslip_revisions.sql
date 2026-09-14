-- Payslip revisions.
--
-- Regenerating a month's payroll overwrote the payslip in place, so a figure
-- somebody had already been shown could change with nothing recording that it
-- had. The revision counts up on every regeneration and the audit log carries
-- the rest; together they answer "was this always what it says now".
ALTER TABLE payslips
    ADD COLUMN revision INT NOT NULL DEFAULT 1 AFTER pdf_path;

-- Existing payslips are revision 1 by definition: they have been generated
-- once, whatever happened before this column existed.
UPDATE payslips SET revision = 1 WHERE revision IS NULL OR revision < 1;
