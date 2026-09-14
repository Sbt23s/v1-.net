-- ============================================================
-- V147 - PIX-E001 works the HR desk too.
--
-- The same request V144 answered for PIX-E058, for the second person doing the
-- same job: everything HR is told, Vanaraja should be told, at the same moment,
-- and everything HR can approve, he should be able to approve.
--
-- WHY ONE GRANT IS THE WHOLE CHANGE
--
-- Nothing in the code names a person. Every service that asks "is this HR" asks
-- it of the role -- LeaveService, PermissionService, WfhService,
-- ComplaintService, HelpdeskService, CommunityService all test IT_MGR, IT_HR and
-- CV_HR together -- and the desk-wide notification lists are built by
-- findByRoleCodes over those same three. So adding IT_HR here reaches the
-- approvals, the queues, the real-time notifications and the visibility in one
-- move, and there is no second list to keep in step.
--
-- That is also why this is not done by adding a rule for two names somewhere:
-- a named exception would have to be repeated in every one of those services
-- and would be missed by the next one written.
--
-- HIS DESIGNATION IS NOT TOUCHED
--
-- Designation is a job title and role is a set of permissions; they are separate
-- columns because they answer separate questions. He keeps the title he has on
-- screen, in the org chart, and on every letter that quotes it.
--
-- HIS EXISTING ROLES ARE KEPT
--
-- Roles add up. Whatever he holds today carries the things he needs as an
-- employee rather than as HR -- his own leave form, his own helpdesk ticket --
-- and removing any of it to "make him HR" would take away his own access to
-- solve somebody else's visibility problem.
--
-- Matched on employee_code rather than on a row id, because ids differ between
-- the copy this was written against and the live database, and a migration that
-- grants HR to whoever happens to be user 12 elsewhere grants HR to a stranger.
--
-- ADDITIVE. One grant, guarded so re-running changes nothing. If the code does
-- not match a user the statement inserts nothing and the migration still
-- succeeds -- which is the correct behaviour for a grant to a named person, and
-- the verification below is how you find out it did not land.
-- ============================================================

INSERT INTO user_roles (user_id, role_id)
SELECT u.id, r.id
FROM users u
JOIN roles r ON r.code = 'IT_HR'
WHERE u.employee_code = 'PIX-E001'
  AND NOT EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = u.id AND ur.role_id = r.id
  );

-- Verification -- all must hold:
--   SELECT u.employee_code, u.name, GROUP_CONCAT(r.code ORDER BY r.code) AS roles
--     FROM users u
--     JOIN user_roles ur ON ur.user_id = u.id
--     JOIN roles r ON r.id = ur.role_id
--    WHERE u.employee_code IN ('HR0001','PIX-E058','PIX-E001')
--    GROUP BY u.id;
--   -- all three carry IT_HR
--
--   SELECT designation_id FROM users WHERE employee_code = 'PIX-E001';
--   -- unchanged
--
--   Then, as each of them: a permission request raised by any employee appears
--   in their queue, and the notification arrives without a page refresh.
