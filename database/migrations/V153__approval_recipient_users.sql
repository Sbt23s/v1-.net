-- ============================================================
-- V153 - Ticking a person, not only a role.
--
-- V151 let an administrator say "Support requests may be addressed to HR".
-- On this company's data HR is three accounts -- the HR account, Elandevan
-- Ravikumar and Vanaraja D -- so that tick offers all three and there was no
-- way to say "the HR account, and not the other two".
--
-- That is the question actually being asked. Naming a role is a shorthand for
-- naming the people in it, and it stops working the moment the role has more
-- than one member and they are not interchangeable.
--
-- HOW IT FITS ALONGSIDE THE ROLE ROWS
--
-- One table, one extra column. A row is either a role rule (role_code set,
-- user_id null) or a person rule (user_id set), and a module may carry a mix.
-- The reader treats them as alternatives: a candidate is offered if a role rule
-- matches them OR a person rule names them.
--
-- Keeping them in one table rather than adding a second means the "absent means
-- unrestricted" rule still has one place to look. A module with no rows of
-- either kind offers whatever it would have offered, which is how every module
-- behaved before V151 and how they behave until somebody configures one.
--
-- WHY NOT REPLACE THE ROLE ROWS
--
-- Because a role rule keeps working when people change. "Whoever is on the HR
-- desk" survives somebody joining or leaving; a list of three names does not,
-- and would quietly stop offering the new joiner. Both are useful and the
-- administrator picks per module.
--
-- role_code becomes nullable for the person rows. The unique key changes with
-- it: MySQL allows repeated NULLs in a unique index, so the old key would have
-- let the same person be added twice. The new one covers both columns.
-- ============================================================

ALTER TABLE approval_recipient_config
    ADD COLUMN user_id BIGINT NULL AFTER role_code;

-- Nullable now: a person row has no role.
ALTER TABLE approval_recipient_config
    MODIFY COLUMN role_code VARCHAR(40) NULL;

-- The old key was (company_id, module_code, role_code). A person row has
-- role_code NULL, and MySQL treats every NULL as distinct in a unique index --
-- so without user_id in the key the same person could be added to a module any
-- number of times, and the screen would show one tick over several rows.
ALTER TABLE approval_recipient_config
    DROP INDEX uk_arc,
    ADD UNIQUE KEY uk_arc (company_id, module_code, role_code, user_id);

-- "Which people are named on this module", the other half of the query the
-- dropdowns run.
CREATE INDEX idx_arc_user ON approval_recipient_config (company_id, module_code, user_id);

-- Verification -- all must hold:
--   SHOW CREATE TABLE approval_recipient_config;
--   -- user_id present, role_code nullable, uk_arc over four columns
--
--   SELECT COUNT(*) FROM approval_recipient_config WHERE role_code IS NULL;
--   -- 0 until somebody ticks a person
--
--   Every existing role tick still works: the rows are untouched and the reader
--   treats a null user_id as "this is a role rule".
