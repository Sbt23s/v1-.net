-- Work From Home requests.
--
-- A separate table rather than a leave type, and the reason matters: a WFH day
-- is a working day. The person is at work, payroll pays them, attendance
-- expects them, and no balance is consumed. Modelled as leave it would deduct
-- from an allocation, appear in the leave calendar as an absence, and count
-- against the quarterly caps -- all of which are wrong for somebody who is
-- working.
--
-- The shape deliberately mirrors leave_requests, so the routing, the statuses
-- and the screens read the same way to anybody who already knows this system.
--
-- Attachments and comments need no schema here: request_attachments and
-- request_comments are keyed by (request_type, request_id), so 'WFH' slots in
-- beside 'LEAVE' and 'PERMISSION' with nothing added.

CREATE TABLE IF NOT EXISTS wfh_requests (
    id                BIGINT       NOT NULL AUTO_INCREMENT,
    -- Kept for the tenant filter the rest of the schema uses. Nullable, as the
    -- other request tables are, because most rows predate multi-tenancy.
    company_id        BIGINT,
    user_id           BIGINT       NOT NULL,

    from_date         DATE         NOT NULL,
    to_date           DATE         NOT NULL,
    -- Weekends and public holidays excluded, as leave counts them. Stored
    -- rather than recomputed: the holiday list can change afterwards and the
    -- figure a person agreed to must not change with it.
    working_days      DECIMAL(5,2) NOT NULL DEFAULT 0,

    reason            VARCHAR(1000),
    -- Anything else the applicant wants the approver to know. Separate from
    -- reason so "why" and "by the way" do not become one paragraph.
    remarks           VARCHAR(1000),

    -- PENDING | APPROVED | REJECTED | CANCELLED
    --
    -- COMPLETED is not stored. It is the past tense of APPROVED and is derived
    -- from the date, so storing it would need a job to run every night and
    -- would be wrong on any day that job failed.
    status            VARCHAR(20)  NOT NULL DEFAULT 'PENDING',

    -- Who it was addressed to, resolved at apply time from the applicant's own
    -- rung: employee -> TL, TL -> HR, HR -> CTO.
    requested_to      BIGINT,
    decided_by        BIGINT,
    decided_at        DATETIME,
    -- The approver's remark, on approval as well as rejection. A reason is
    -- required to reject; a note is optional to approve.
    decision_comment  VARCHAR(1000),

    created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
                                   ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    -- "my requests", newest first.
    KEY idx_wfh_user (user_id, created_at),
    -- "waiting on me".
    KEY idx_wfh_inbox (requested_to, status),
    -- "who is working from home today", which is the status board's only query.
    KEY idx_wfh_window (status, from_date, to_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
