-- ============================================================
-- V79 — chat: search, pinning, threads, reactions, read receipts,
--       acknowledgements, scheduled posts, polls, retention.
--
-- Everything here is additive. Existing messages keep working
-- exactly as they are: parent_id null means a top-level message,
-- pinned_at null means not pinned, scheduled_at null means posted
-- immediately, requires_ack false means nothing to acknowledge,
-- and poll_options null means an ordinary message.
--
-- Nothing outside the chat tables is touched.
-- ============================================================

ALTER TABLE community_messages
    -- A reply belongs to the message it answers; null is a top-level post.
    ADD COLUMN parent_id    BIGINT   NULL AFTER community_id,
    -- When and by whom a message was pinned to the top of its room.
    ADD COLUMN pinned_at    DATETIME NULL,
    ADD COLUMN pinned_by    BIGINT   NULL,
    -- Set in the future to hold a message back until then.
    ADD COLUMN scheduled_at DATETIME NULL,
    -- An announcement people must confirm they have read.
    ADD COLUMN requires_ack BOOLEAN  NOT NULL DEFAULT FALSE,
    -- A poll's choices, as a JSON array of labels. Null for a normal message.
    ADD COLUMN poll_options TEXT     NULL;

ALTER TABLE community_messages
    ADD CONSTRAINT fk_msg_parent FOREIGN KEY (parent_id)
        REFERENCES community_messages(id) ON DELETE CASCADE;

CREATE INDEX idx_msg_parent ON community_messages (parent_id);
CREATE INDEX idx_msg_pinned ON community_messages (community_id, pinned_at);
CREATE INDEX idx_msg_scheduled ON community_messages (scheduled_at);

-- ---- Reactions: one row per person per emoji per message ----
CREATE TABLE community_message_reactions (
    id         BIGINT AUTO_INCREMENT PRIMARY KEY,
    message_id BIGINT      NOT NULL,
    user_id    BIGINT      NOT NULL,
    emoji      VARCHAR(16) NOT NULL,
    created_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_react_msg  FOREIGN KEY (message_id) REFERENCES community_messages(id) ON DELETE CASCADE,
    CONSTRAINT fk_react_user FOREIGN KEY (user_id)    REFERENCES users(id)              ON DELETE CASCADE,
    UNIQUE KEY uq_react (message_id, user_id, emoji)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---- Read receipts, and the acknowledgement of an announcement ----
-- One row per person per message: read_at is set on first sight,
-- acknowledged_at only when they press the confirm button.
CREATE TABLE community_message_reads (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    message_id      BIGINT   NOT NULL,
    user_id         BIGINT   NOT NULL,
    read_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    acknowledged_at DATETIME NULL,
    CONSTRAINT fk_read_msg  FOREIGN KEY (message_id) REFERENCES community_messages(id) ON DELETE CASCADE,
    CONSTRAINT fk_read_user FOREIGN KEY (user_id)    REFERENCES users(id)              ON DELETE CASCADE,
    UNIQUE KEY uq_read (message_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---- Poll votes: one vote per person per poll ----
CREATE TABLE community_poll_votes (
    id           BIGINT AUTO_INCREMENT PRIMARY KEY,
    message_id   BIGINT   NOT NULL,
    user_id      BIGINT   NOT NULL,
    option_index INT      NOT NULL,
    voted_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_vote_msg  FOREIGN KEY (message_id) REFERENCES community_messages(id) ON DELETE CASCADE,
    CONSTRAINT fk_vote_user FOREIGN KEY (user_id)    REFERENCES users(id)              ON DELETE CASCADE,
    UNIQUE KEY uq_vote (message_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---- Retention: how long chat history is kept ----
-- 0 means keep everything, which is what it starts as, so nothing is
-- deleted until somebody chooses a period.
INSERT INTO system_settings (setting_key, setting_value)
SELECT 'chat.retention_days', '0'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM system_settings WHERE setting_key = 'chat.retention_days');
