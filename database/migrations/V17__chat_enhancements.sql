-- V17: Chat enhancements - Add is_announcement and seed Company Announcements
ALTER TABLE communities ADD COLUMN is_announcement BOOLEAN DEFAULT FALSE;

-- Insert a default Company Announcements group, created by admin (ADM0001)
INSERT INTO communities (name, description, created_by, is_announcement)
SELECT 'Company Announcements', 'Official company announcements and updates.', id, TRUE
FROM users WHERE employee_code = 'ADM0001' LIMIT 1;

-- Auto-add all existing users to the Company Announcements group
INSERT INTO community_members (community_id, user_id)
SELECT c.id, u.id
FROM communities c
CROSS JOIN users u
WHERE c.name = 'Company Announcements' AND c.is_announcement = TRUE;
