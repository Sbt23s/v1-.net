-- ============================================================
-- V140 - Biometric attendance from Hikvision Hik-Connect for Teams.
--
-- NUMBERED 140, FOR THE SAME REASON V139 WAS NUMBERED 139
--
-- Two migration lineages share this schema. The employee-portal-v1 branch runs
-- to V138 and reuses low numbers this branch has never used; V139 was the first
-- version past both. 140 is the next free one. Reusing a number is silent
-- rather than loud here: FlywayConfig sets repair-on-migrate with
-- validate-on-migrate off, so Flyway rewrites the stored checksum, reports
-- "Schema is up to date", applies nothing, and startup then dies on schema
-- validation naming a column that this file was supposed to create.
--
-- WHAT THIS IS FOR
--
-- A wall-mounted Hikvision face/fingerprint terminal reports a punch to
-- Hik-Connect, which pushes it to us over a webhook. Two tables receive it:
-- one for the raw event exactly as it arrived, one to answer "which employee
-- is that". Neither replaces the attendance register -- attendance rows are
-- still the processed truth that payroll reads, and this migration does not
-- touch that table at all.
--
-- WHY RAW EVENTS ARE STORED SEPARATELY
--
-- The event is evidence and the attendance row is a conclusion. Storing only
-- the conclusion means a disputed punch six weeks later has nothing behind it:
-- which device, which area, face or fingerprint, did the terminal accept the
-- authentication, was it live or replayed from the device's offline buffer.
-- The raw row also lets the processing rules change without the history being
-- lost -- events can be reprocessed, an attendance row that was derived wrongly
-- cannot be un-derived.
--
-- WHY attendance IS NOT ALTERED
--
-- Payroll reads attendance, and V139's own notes record what happens when a
-- payroll-facing table changes shape unexpectedly. Everything biometric that
-- attendance needs -- the punch time, the device name -- already has a column
-- there (punch_in_at, punch_out_at, in_device, out_device). The link back to
-- the originating event lives on the event side, in biometric_events.user_id.
--
-- ADDITIVE. Two new tables. No existing table is altered, no row changes value.
-- ============================================================

-- ---------- 1. Which Hikvision person is which employee ----------
--
-- The join has to exist as a table rather than a lookup, because the pushed
-- event does not carry the employee number.
--
-- Hikvision's authentication event (IntelliInfo, §A.3.106 of the V2.15.0
-- guide) carries personId, firstName, lastName and authResult -- and no
-- personCode. personCode, which is the Employee No. and the only field that
-- means anything to this portal, appears in PersonInfo(1) on the person APIs
-- instead. Worse, POST /persons/list filters on name, email and phone only, so
-- it cannot be asked "who has personCode EMP001?" at all.
--
-- So the mapping is built ahead of time by paging the whole person list
-- (pageSize maxes at 100) and stored here. An event then resolves in one
-- indexed lookup on hik_person_id, with no call to Hikvision on the hot path --
-- which also keeps us clear of the documented limit of 5 requests per second.
--
-- The enrolment flags are cached from
-- /acspm/v1/maintain/overview/person/{id}/elementdetail, whose
-- certificateStatusList reports type 1 (fingerprint) and type 2 (face) with
-- status 0 meaning applied. They are shown on the employee's profile; they are
-- a cache, and synced_at says how stale.

CREATE TABLE IF NOT EXISTS hik_person_map (
    id                   BIGINT       NOT NULL AUTO_INCREMENT,

    -- Nullable for the same reason the other tenant columns are: rows can be
    -- created by a sync that runs before a company is resolved. Every read
    -- path still filters on it.
    company_id           BIGINT,
    user_id              BIGINT       NOT NULL,

    -- IntelliInfo.personId. Hikvision's own identifier and the only thing the
    -- pushed event gives us to match on.
    hik_person_id        VARCHAR(64)  NOT NULL,

    -- PersonInfo(1).personCode -- Hikvision's "Employee No.", which is what an
    -- administrator types into Hik-Connect to mirror users.employee_code.
    -- Nullable: a person can exist on the terminal with no employee number set,
    -- and that is exactly the case an administrator needs to see rather than
    -- have hidden by a failed insert.
    person_code          VARCHAR(32),

    -- Cached from certificateStatusList. Not authoritative -- the device is --
    -- which is why synced_at travels with them.
    face_enrolled        TINYINT(1)   NOT NULL DEFAULT 0,
    fingerprint_enrolled TINYINT(1)   NOT NULL DEFAULT 0,
    synced_at            DATETIME,

    created_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
                                      ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),

    -- One Hikvision person is one employee, in both directions.
    --
    -- Without the first key a re-run of the sync would insert the same person
    -- again and the event lookup would depend on row order. Without the second,
    -- two terminal identities could point at one employee and their punches
    -- would interleave into one attendance row with no way to tell them apart.
    UNIQUE KEY uk_hik_person (hik_person_id),
    UNIQUE KEY uk_hik_user (user_id),

    -- The sync reconciles by employee number, so it reads this column for every
    -- person on every run.
    KEY idx_hik_person_code (person_code),
    KEY idx_hik_company (company_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- 2. The raw punch, as the terminal reported it ----------
--
-- One row per authentication event pushed by Hik-Connect. Written before
-- anything is interpreted, and never edited afterwards except to mark it
-- processed.

CREATE TABLE IF NOT EXISTS biometric_events (
    id                BIGINT       NOT NULL AUTO_INCREMENT,

    company_id        BIGINT,

    -- Nullable on purpose, and this is the important nullable column in the
    -- table. A punch by somebody who is on the terminal but not mapped to an
    -- employee still has to be recorded: dropping it would lose a real event,
    -- and refusing the webhook would make Hikvision retry a message that can
    -- never succeed. An unmatched row is visible to HR as "this person punched
    -- and we do not know who they are", which is the actionable form of the
    -- problem.
    user_id           BIGINT,
    hik_person_id     VARCHAR(64),

    -- basicInfo.eventType, which is the message type with the "Msg" prefix
    -- removed (§A.3.43). The three that matter: 110013 face, 110005
    -- fingerprint, 110008 face and fingerprint. Stored as the number Hikvision
    -- sent rather than as our own enum, so an event type we do not yet handle
    -- is still recorded faithfully.
    event_type        INT          NOT NULL,

    -- Our reading of event_type: FACE | FINGERPRINT | FACE_FINGERPRINT | OTHER.
    -- Derived, but stored, because it is what every screen and report groups by
    -- and deriving it in SQL would spread the mapping across the codebase.
    auth_method       VARCHAR(24),

    -- IntelliInfo.authResult: 1 succeeded, 0 failed. A failed authentication is
    -- kept -- it is how a broken enrolment or a stranger at the door shows up --
    -- and it is why processing must check this rather than assume every row is
    -- a valid punch.
    auth_result       INT,

    -- basicInfo.occurTime: when the terminal says it happened. Distinct from
    -- received_at, and the two differ by days when a device has been offline.
    -- Attendance is keyed off this one.
    occur_time        DATETIME     NOT NULL,

    device_id         VARCHAR(64),
    device_serial     VARCHAR(64),
    device_name       VARCHAR(128),
    area_id           VARCHAR(64),
    area_name         VARCHAR(128),

    -- basicInfo.serialNo, the device's own counter for the event.
    hik_serial_no     BIGINT,

    -- basicInfo.currentEvent: 0 means the device buffered this while offline
    -- and is replaying it now, 1 means it is live. The guide notes the field is
    -- absent on a current event, so absent is read as 1. Kept because a
    -- backfilled punch and a live one must not look identical -- one of them
    -- arrived hours late and should not, for instance, trigger a "just arrived"
    -- notification.
    current_event     INT,

    -- IntelliInfo.attendanceStatus: 0 undefined, 1 on work, 2 off work,
    -- 3 break starts, 4 break ends, 5 overtime starts, 6 overtime ends.
    -- Hikvision's own opinion about the punch, which is frequently 0 -- the
    -- worked example in the guide itself shows 0 -- so it informs the in/out
    -- decision without deciding it.
    attendance_status INT,

    -- The webhook batch this arrived in, from the push body and the
    -- X-Hook-Batch-Id header. Kept for tracing a delivery end to end.
    batch_id          VARCHAR(64),

    -- IN | OUT, as this portal concluded. Not a Hikvision field: the guide's
    -- `direction` (1 entrance, 2 exit) belongs to the record-search response
    -- and is not on the pushed event, and attendanceStatus is often undefined.
    -- Recorded so that a punch can be re-read later as what it was taken to
    -- mean at the time, even if the rule changes afterwards.
    direction         VARCHAR(10),

    -- Whether this event has been folded into an attendance row yet. The
    -- processor claims rows by this flag, so a crash mid-batch resumes rather
    -- than double-counting or dropping.
    processed         TINYINT(1)   NOT NULL DEFAULT 0,
    processed_at      DATETIME,

    -- Why an event could not be processed, if it could not. Held on the row
    -- rather than only in the log, because the row is what somebody looks at
    -- when a punch did not appear on the register.
    process_error     VARCHAR(500),

    -- The whole push, verbatim. Costs little and settles arguments: the fields
    -- above are what we chose to read, and this is what actually arrived.
    raw_payload       JSON,

    received_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),

    -- Duplicate protection, and the reason the webhook can be answered safely.
    --
    -- The guide gives retryTimes a default of 3, so a push we accepted but
    -- answered too slowly arrives again. Hikvision has no idempotency key of
    -- its own on the event, but the device serial plus that device's own event
    -- counter plus the moment it occurred identify one punch exactly. A repeat
    -- delivery fails this key, and the receiver treats that failure as success
    -- -- which is what makes a retry harmless instead of a second punch.
    --
    -- hik_serial_no is nullable and MySQL allows repeated NULLs in a unique
    -- index, so an event arriving without a serial number is not silently
    -- deduplicated against an unrelated one. Those are rare and are caught by
    -- the processor instead.
    UNIQUE KEY uk_bio_event (device_serial, hik_serial_no, occur_time),

    -- "this employee's punches, oldest to newest" -- the query the processor
    -- and the daily timeline both run.
    KEY idx_bio_user_time (user_id, occur_time),
    -- The processor's own queue.
    KEY idx_bio_unprocessed (processed, received_at),
    -- "which punches have not been matched to anybody", for the HR screen.
    KEY idx_bio_unmatched (company_id, user_id, occur_time),
    KEY idx_bio_person (hik_person_id, occur_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Verification -- all must hold:
--   SHOW CREATE TABLE hik_person_map;    -- uk_hik_person and uk_hik_user present
--   SHOW CREATE TABLE biometric_events;  -- uk_bio_event present
--   SELECT COUNT(*) FROM attendance;     -- unchanged by this migration
