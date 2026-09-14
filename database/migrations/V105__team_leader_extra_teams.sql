-- A Team Leader may lead more than one team.
--
-- A "team" in this product is a designation title: an employee's Team Leader is
-- the person holding IT_TL whose designation matches their own. That allows
-- exactly one leader per team and one team per leader, so a team whose leader
-- holds a different designation -- QA Testing, which has employees but nobody
-- carrying that designation as a Team Leader -- has no leader at all, and its
-- leave, permission and work-from-home requests fall through to whoever the
-- fallback happens to pick.
--
-- This table records the extra teams a leader covers, alongside the one their
-- own designation already gives them. It adds; it never removes. A leader with
-- no row here behaves exactly as before.
CREATE TABLE IF NOT EXISTS team_leader_team (
    id           BIGINT       NOT NULL AUTO_INCREMENT,
    user_id      BIGINT       NOT NULL,
    -- Stored as the designation title rather than an FK, because that is what
    -- the matching compares and what employee records actually carry. Matching
    -- is case-insensitive and trimmed in code, as it already is everywhere else.
    team_title   VARCHAR(160) NOT NULL,
    created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by   BIGINT       NULL,
    PRIMARY KEY (id),
    -- One row per leader per team: assigning the same team twice is a mistake,
    -- not a second assignment.
    UNIQUE KEY uq_tlt_user_team (user_id, team_title),
    KEY idx_tlt_user (user_id),
    KEY idx_tlt_team (team_title)
    -- No foreign key, matching wfh_requests and the other request tables: this
    -- schema keeps referential integrity in the service layer rather than in
    -- constraints. A row whose user has gone simply matches nobody.
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
