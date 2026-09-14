-- ============================================================
-- V151 - Which roles a module may address a request to.
--
-- Every "Request to" / "Send to" dropdown in the portal is built by its own
-- service, each with its own hard-coded idea of who belongs in it:
--
--   HelpdeskService.agents()     CTO, one system admin, the HR desk
--   ComplaintService.recipients() the same three, assembled separately
--   PermissionService / LeaveService  their own approver chains
--
-- So changing who can be addressed meant changing Java, and the four lists
-- drifted from each other because nothing held them to a common answer.
--
-- This table is that answer. A row says "for module X, role Y may be
-- addressed". The dropdown services read it and filter what they would
-- otherwise have offered.
--
-- WHY A FILTER RATHER THAN A SOURCE
--
-- The services know things the table cannot: that a complaint from HR goes
-- above HR, that an employee's short leave stays with their own team leader,
-- that nobody appears in their own dropdown. Those are routing rules, not
-- preferences, and replacing them with a flat list of roles would lose them.
--
-- So configuration narrows the candidates; it does not produce them. Ticking
-- a role that a module never offers changes nothing, and unticking one removes
-- it everywhere that module asks.
--
-- ABSENT MEANS UNRESTRICTED
--
-- A module with no rows behaves exactly as it does today. That is deliberate:
-- this migration creates the table empty, so nothing changes until somebody
-- configures something, and a bug in the reading code cannot empty a dropdown
-- that was working. It also means "allow everything" is expressible -- delete
-- the module's rows.
-- ============================================================

CREATE TABLE IF NOT EXISTS approval_recipient_config (
    id          BIGINT       NOT NULL AUTO_INCREMENT,

    -- Which tenant this configuration belongs to. Nullable for the same reason
    -- holidays are: a single-company install has no id to put here, and the
    -- readers treat NULL as "applies to everyone".
    company_id  BIGINT,

    -- The module whose dropdown this governs: HELPDESK, COMPLAINT, PERMISSION,
    -- LEAVE, WFH. Stored as the code rather than an enum column so a module
    -- added later needs no migration.
    module_code VARCHAR(40)  NOT NULL,

    -- The role that may be addressed -- IT_HR, CV_HR, IT_MGR, IT_TL,
    -- SUPER_ADMIN, and the pseudo-role CTO, which is an employee code rather
    -- than a role in this schema and is spelled out here so the two kinds of
    -- recipient can sit in one list.
    role_code   VARCHAR(40)  NOT NULL,

    -- Off without deleting the row, so unticking and re-ticking does not lose
    -- who configured it or when.
    enabled     TINYINT(1)   NOT NULL DEFAULT 1,

    updated_by  BIGINT,
    updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
                             ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),

    -- One row per module per role per company. Without this a double-click on
    -- Save writes the same permission twice and the reader sees a duplicate
    -- that is invisible on screen.
    UNIQUE KEY uk_arc (company_id, module_code, role_code),

    -- The query every dropdown runs: "what may this module address".
    KEY idx_arc_module (company_id, module_code, enabled)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Deliberately no seed rows. An empty table means every module behaves exactly
-- as it does today, so this migration changes nothing on its own and the
-- feature is opt-in per module.

-- Verification -- all must hold:
--   SHOW CREATE TABLE approval_recipient_config;   -- uk_arc present
--   SELECT COUNT(*) FROM approval_recipient_config; -- 0
--   Every "Request to" dropdown still lists what it listed before.
