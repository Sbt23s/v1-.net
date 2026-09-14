-- Attachments and a comment thread on leave and permission requests.
--
-- WHY A TABLE RATHER THAN A COLUMN
--
-- leave_requests already has attachment_path, a single VARCHAR(255). One file
-- per request was enough when the field was added and is not enough now: a
-- medical certificate is often several pages photographed one at a time. A
-- comma-separated list in one column would have been the cheaper change, but
-- it cannot record who uploaded what or when, cannot be deleted a file at a
-- time, and silently truncates at 255 characters -- which is four or five
-- paths, reached quickly and without an error.
--
-- The existing attachment_path column is left exactly as it is. Rows that
-- already carry a value keep working; nothing reads it differently.
--
-- WHY ONE TABLE FOR BOTH KINDS
--
-- A leave attachment and a permission attachment differ only in what they
-- hang off. Two tables would mean two repositories, two endpoints and two of
-- every future change, so the owner is (request_type, request_id) -- the same
-- shape the notification table already uses for its subject.

CREATE TABLE IF NOT EXISTS request_attachments (
    id            BIGINT       NOT NULL AUTO_INCREMENT,
    -- LEAVE | PERMISSION. Deliberately not an enum: MySQL enums need a schema
    -- change to add a value, and the next thing somebody attaches a file to
    -- should not require a migration.
    request_type  VARCHAR(20)  NOT NULL,
    request_id    BIGINT       NOT NULL,
    -- The stored path, as StorageService returns it.
    file_path     VARCHAR(500) NOT NULL,
    -- What the person called it, kept so a download is not named
    -- "a3f9c2e1.pdf". Their filename, never used to build a path.
    file_name     VARCHAR(255) NOT NULL,
    content_type  VARCHAR(120),
    file_size     BIGINT,
    uploaded_by   BIGINT       NOT NULL,
    uploaded_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    -- The only query this table serves: everything attached to one request.
    KEY idx_request_attachments_owner (request_type, request_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The conversation between an applicant and their approver.
--
-- Not the same thing as decision_comment, which is the one line recorded with
-- a decision and belongs to the decision. This is a thread: an approver asks
-- which client, the applicant answers, and both are visible to both. Keeping
-- them apart means a decision still reads as a decision rather than as the
-- last message in a chat.
CREATE TABLE IF NOT EXISTS request_comments (
    id            BIGINT      NOT NULL AUTO_INCREMENT,
    request_type  VARCHAR(20) NOT NULL,
    request_id    BIGINT      NOT NULL,
    author_id     BIGINT      NOT NULL,
    message       TEXT        NOT NULL,
    -- One file may ride along with a message, as it does on a ticket comment.
    attachment_path VARCHAR(500),
    created_at    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    -- Read in order, which is how a conversation is read.
    KEY idx_request_comments_thread (request_type, request_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
