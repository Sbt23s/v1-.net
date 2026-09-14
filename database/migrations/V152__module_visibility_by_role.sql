-- ============================================================
-- V152 - Which approval modules a role sees at all.
--
-- V151 answered "who may a request be addressed to". This answers the other
-- half: which of the five modules a given role sees in the first place.
--
-- They are different questions and both get asked. "Team Leaders may be
-- addressed on Permission" is V151. "Team Leaders do not see Work From Home"
-- is this one -- nothing to do with recipients, and no amount of ticking in
-- V151 expresses it.
--
-- Today the answer is hard-coded: the Leave Management tabs are chosen by
-- LeaveManagement.tsx from role and permission checks written into the
-- component, so changing which modules a Team Leader sees means changing
-- TypeScript and deploying.
--
-- ABSENT MEANS VISIBLE
--
-- Same rule as V151, for the same reason. A role with no rows behaves exactly
-- as it does today, the table ships empty, and nothing changes until somebody
-- configures something. A bug in the reading code cannot hide a module that
-- was working.
--
-- WHAT THIS DOES NOT DO
--
-- It does not grant. Hiding Approvals from a role that holds LEAVE_APPROVE
-- takes the tab off their screen; it does not stop the endpoint answering
-- them, and it must not -- authorisation is Spring Security's, decided per
-- request against the permission, and a display preference is not a security
-- boundary. Ticking a module visible for a role that lacks the permission
-- likewise grants nothing: the tab appears and the page inside it refuses.
--
-- That separation is deliberate. This table is about what is worth showing
-- somebody; the guards are about what they may do.
-- ============================================================

CREATE TABLE IF NOT EXISTS role_module_visibility (
    id          BIGINT       NOT NULL AUTO_INCREMENT,

    -- Nullable for the same reason as V151: a single-company install has no id
    -- to put here, and the readers treat NULL as "applies to everyone".
    company_id  BIGINT,

    -- IT_EMP, IT_TL, IT_HR, CV_HR, IT_MGR, SUPER_ADMIN, COMPANY_ADMIN, or the
    -- pseudo-role CTO -- which is an employee code rather than a role in this
    -- schema, spelled here as one so both kinds of subject sit in one list.
    role_code   VARCHAR(40)  NOT NULL,

    -- LEAVE | PERMISSION | WFH | APPROVALS | POLICIES. The Leave Management
    -- tabs, which is where this is read.
    module_code VARCHAR(40)  NOT NULL,

    -- Off without deleting the row, so unticking and re-ticking does not lose
    -- who changed it or when.
    visible     TINYINT(1)   NOT NULL DEFAULT 1,

    updated_by  BIGINT,
    updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
                             ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),

    -- One row per role per module per company; a double-click on Save would
    -- otherwise write the same preference twice, invisibly.
    UNIQUE KEY uk_rmv (company_id, role_code, module_code),

    -- The query the page runs on load: "what does this role see".
    KEY idx_rmv_role (company_id, role_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- No seed rows, deliberately. Every role sees what it sees today until
-- somebody changes it here.

-- Verification -- all must hold:
--   SHOW CREATE TABLE role_module_visibility;    -- uk_rmv present
--   SELECT COUNT(*) FROM role_module_visibility;  -- 0
--   Leave Management shows every role the same tabs it showed before.
