-- ============================================================
-- V144 - PIX-E058 works the HR desk, and the portal did not know it.
--
-- Elandevan Ravikumar holds IT_EMP alone, so the portal treats him as an
-- ordinary employee: no approvals, no employee management, no payroll, and
-- none of the HR queues. He does the job; the access says otherwise.
--
-- Adding IT_HR gives him exactly what HR has, because that is what the role
-- is: sixteen permissions plus the three V143 adds. Every service that asks
-- "is this person HR" tests the role code -- LeaveService, PermissionService,
-- WfhService, ComplaintService, HelpdeskService, CommunityService -- so one
-- grant reaches all of them at once, including the desk-wide visibility and
-- notifications added alongside.
--
-- HIS DESIGNATION IS NOT TOUCHED
--
-- He stays Office Administrator on screen. Designation is a job title and role
-- is a set of permissions; they are separate columns because they answer
-- separate questions, and changing the title would rewrite his profile, the
-- org chart and every letter that quotes it to solve an access problem.
--
-- IT_EMP IS KEPT
--
-- Roles add up. Removing IT_EMP would take away LEAVE_APPLY and HELPDESK_RAISE
-- -- the things he needs as an employee rather than as HR -- and V143 grants
-- those to IT_HR precisely because holding IT_HR alone should not cost anybody
-- their own leave form. Keeping both is belt and braces, and costs nothing:
-- permissions are a union.
--
-- Matched on employee_code rather than on a row id, because ids differ between
-- the copy this was written against and the live database, and a migration
-- that grants a role to whoever happens to be user 190 elsewhere is a
-- migration that grants HR to a stranger.
--
-- ADDITIVE. One grant, guarded so re-running changes nothing.
-- ============================================================

INSERT INTO user_roles (user_id, role_id)
SELECT u.id, r.id
FROM users u
JOIN roles r ON r.code = 'IT_HR'
WHERE u.employee_code = 'PIX-E058'
  AND NOT EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = u.id AND ur.role_id = r.id
  );

-- Verification -- all must hold:
--   SELECT u.employee_code, GROUP_CONCAT(r.code) FROM users u
--     JOIN user_roles ur ON ur.user_id = u.id
--     JOIN roles r ON r.id = ur.role_id
--    WHERE u.employee_code = 'PIX-E058' GROUP BY u.id;
--   -- IT_EMP, IT_HR
--
--   SELECT designation_id FROM users WHERE employee_code = 'PIX-E058';
--   -- unchanged: he is still Office Administrator on screen
