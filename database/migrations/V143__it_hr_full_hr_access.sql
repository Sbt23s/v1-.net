-- ============================================================
-- V143 - IT_HR gets the three permissions IT_MGR has and it does not.
--
-- Both roles are HR. Every service that asks "is this person HR" tests for
-- IT_MGR or IT_HR together -- LeaveService, PermissionService, WfhService,
-- ComplaintService, HelpdeskService, CommunityService all do it the same way --
-- so the two are treated as one desk everywhere in the code.
--
-- The permission grants never matched that. Comparing the two roles on the live
-- database:
--
--   HELPDESK_RAISE   IT_MGR yes, IT_HR no
--   LEAVE_APPLY      IT_MGR yes, IT_HR no
--   PAYROLL_VIEW     IT_MGR yes, IT_HR no
--
-- So somebody holding IT_HR alone could agent the helpdesk but not raise a
-- ticket, approve everybody's leave but not apply for their own, and run
-- payroll but not look at a salary. Each reads as a broken screen rather than
-- as a missing grant: the button is absent, or the page answers 403, and
-- nothing says why.
--
-- The person holding IT_HR today also holds IT_MGR, which is why this has gone
-- unnoticed -- their IT_MGR grants covered the gaps. The next person given
-- IT_HR on its own would find three parts of the portal missing.
--
-- WHY NOT REMOVE THE DISTINCTION INSTEAD
--
-- Because it is real in one place: IT_MGR is the manager role and IT_HR is the
-- HR desk, and PermissionService deliberately notifies only IT_HR and CV_HR
-- when a request reaches HR -- copying every request to two managers who do not
-- work the queue would make the notification worthless. The roles differ in who
-- is told; they should not differ in what they can do.
--
-- ADDITIVE. Three grants. No permission is removed from any role, and a role
-- that already holds one of these is left alone by the NOT EXISTS guard.
-- ============================================================

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN ('HELPDESK_RAISE', 'LEAVE_APPLY', 'PAYROLL_VIEW')
WHERE r.code IN ('IT_HR', 'CV_HR')
  AND NOT EXISTS (
      SELECT 1 FROM role_permissions rp
      WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );

-- CV_HR is included for the same reason it appears beside IT_HR in every
-- service: it is the civil-side HR desk and holds the same job.

-- Verification -- all must hold:
--   SELECT p.code FROM roles r
--     JOIN role_permissions rp ON rp.role_id = r.id
--     JOIN permissions p ON p.id = rp.permission_id
--    WHERE r.code = 'IT_HR' AND p.code IN ('HELPDESK_RAISE','LEAVE_APPLY','PAYROLL_VIEW');
--   -- three rows
--
--   SELECT COUNT(*) FROM role_permissions;   -- grew by at most six
