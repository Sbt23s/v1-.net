-- One-time backfill: employees created after V17 were never added to the
-- "Company Announcements" channel, so they missed every announcement
-- notification. Add every enabled, non-offboarded user who is still missing.
INSERT INTO community_members (community_id, user_id)
SELECT c.id, u.id
FROM communities c
CROSS JOIN users u
WHERE c.name = 'Company Announcements'
  AND c.is_announcement = TRUE
  AND u.enabled = TRUE
  AND (u.profile_status IS NULL OR u.profile_status <> 'OFFBOARDED')
  AND NOT EXISTS (
      SELECT 1 FROM community_members cm
      WHERE cm.community_id = c.id AND cm.user_id = u.id
  );
