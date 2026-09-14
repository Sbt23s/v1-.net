-- When each person was last connected.
--
-- Who is online right now is held in memory, because a live socket is the only
-- honest answer to that question. This column answers the other half — "last
-- seen at 7:40 PM" — and survives a restart, which memory does not.
ALTER TABLE users
    ADD COLUMN last_seen_at DATETIME NULL;
